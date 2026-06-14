(function () {
  'use strict';

  const DATA_URL = './public.json';
  const MODE_VALUES = ['bar', 'scatter', 'line', 'map'];
  const LINE_TOTAL_VALUE = '合計';
  const BAR_LIMIT_VALUES = ['all', '10', '20', '50'];
  const BAR_RANK_VALUES = ['value', 'diffUp', 'diffDown', 'rateUp', 'rateDown'];
  const MAP_STYLE_VALUES = ['heat', 'bars'];
  const MAP_SVG_URL = './Japan_Map_Lincun.svg';
  const MAP_SOURCE_TEXT = '出典：「日本の図書館 統計と名簿」（日本図書館協会）、人口統計（e-stat）、「日本地図.svg」（wikipedia）を加工して作成';
  const MAP_PREFECTURE_COUNT = 47;
  const LINCUN_MAIN_CLIP_PATH = 'M512 0h512v1024h-1024v-512a512 512 0 0 0 512 -512z';
  const LINCUN_SUB_CLIP_PATH = 'M-360 984h512a512 512 0 0 1 -512 512z';
  const LINCUN_SUB_TRANSLATE_X = 360;
  const LINCUN_SUB_TRANSLATE_Y = -984;
  const MAP_CENTER_OVERRIDES = {
    北海道: { x: 752, y: 167.5 },
    東京: { x: 624, y: 672 },
    新潟: { x: 573.5, y: 533 },
    島根: { x: 255, y: 695 },
    長崎: { x: 117.5, y: 808 },
    鹿児島: { x: 147, y: 898 },
    沖縄: { x: 341.5, y: 216 }
  };
  const METRIC_CATEGORY_ORDER = ['基本', '図書館数', '設置自治体', '職員', '蔵書・受入', '利用', '経費', 'その他'];
  const CHART_COLORS = [
    '#4A90E2',
    '#D94F70',
    '#28A17A',
    '#F2A93B',
    '#6F63D9',
    '#8A6A45',
    '#3D8D99',
    '#C95C2E',
    '#607D3B',
    '#A24B8F'
  ];

  let chart = null;
  let chartMode = 'bar';
  let years = [];
  let materials = [];
  let universities = [];
  let metrics = {};
  let controlsDiv = null;
  let suppressUrlUpdate = true;
  let universityPickerConfigs = {};
  let shareStatusTimer = null;
  let suppressEmbeddedChartText = false;
  let mapPrefecturePaths = [];
  let mapSvgLoadError = null;

  const footerPlugin = {
    id: 'footerPlugin',
    afterDraw: chartInstance => {
      if (suppressEmbeddedChartText) return;

      const ctx = chartInstance.ctx;
      const area = chartInstance.chartArea;
      if (!area) return;

      const text = getSourceText();
      ctx.save();
      ctx.font = '12px sans-serif';
      ctx.fillStyle = '#666';
      const width = ctx.measureText(text).width;
      const x = Math.max(area.left, chartInstance.width - width - 16);
      ctx.fillText(text, x, chartInstance.height - 10);
      ctx.restore();
    }
  };

  const quadrantPlugin = {
    id: 'quadrantPlugin',
    beforeDatasetsDraw: chartInstance => {
      const options = chartInstance.options.plugins?.quadrant;
      if (!options?.enabled) return;

      const area = chartInstance.chartArea;
      const xScale = chartInstance.scales.x;
      const yScale = chartInstance.scales.y;
      if (!area || !xScale || !yScale) return;
      if (!Number.isFinite(options.xMedian) || !Number.isFinite(options.yMedian)) return;

      const x = xScale.getPixelForValue(options.xMedian);
      const y = yScale.getPixelForValue(options.yMedian);
      const ctx = chartInstance.ctx;

      ctx.save();
      ctx.strokeStyle = 'rgba(80, 80, 80, 0.48)';
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 5]);
      if (x >= area.left && x <= area.right) {
        ctx.beginPath();
        ctx.moveTo(x, area.top);
        ctx.lineTo(x, area.bottom);
        ctx.stroke();
      }
      if (y >= area.top && y <= area.bottom) {
        ctx.beginPath();
        ctx.moveTo(area.left, y);
        ctx.lineTo(area.right, y);
        ctx.stroke();
      }
      ctx.restore();
    },
    afterDraw: chartInstance => {
      const options = chartInstance.options.plugins?.quadrant;
      if (!options?.enabled) return;

      const area = chartInstance.chartArea;
      if (!area) return;

      const ctx = chartInstance.ctx;
      const labels = options.labels || {};
      const positions = [
        { text: labels.topLeft, x: area.left + 10, y: area.top + 20, align: 'left' },
        { text: labels.topRight, x: area.right - 10, y: area.top + 20, align: 'right' },
        { text: labels.bottomLeft, x: area.left + 10, y: area.bottom - 10, align: 'left' },
        { text: labels.bottomRight, x: area.right - 10, y: area.bottom - 10, align: 'right' }
      ];

      ctx.save();
      ctx.font = 'bold 12px sans-serif';
      ctx.textBaseline = 'middle';
      positions.forEach(position => {
        if (!position.text) return;

        const metrics = ctx.measureText(position.text);
        const paddingX = 6;
        const paddingY = 4;
        const width = metrics.width + paddingX * 2;
        const height = 20;
        const boxX = position.align === 'right' ? position.x - width : position.x;
        const boxY = position.y - height / 2;

        ctx.fillStyle = 'rgba(255, 255, 255, 0.86)';
        ctx.fillRect(boxX, boxY, width, height);
        ctx.strokeStyle = 'rgba(80, 80, 80, 0.18)';
        ctx.strokeRect(boxX, boxY, width, height);
        ctx.fillStyle = 'rgba(60, 60, 60, 0.9)';
        ctx.textAlign = position.align;
        ctx.fillText(position.text, position.x + (position.align === 'right' ? -paddingX : paddingX), position.y);
      });
      ctx.restore();
    }
  };

  function ready(fn) {
    if (document.readyState !== 'loading') {
      fn();
      return;
    }
    document.addEventListener('DOMContentLoaded', fn);
  }

  ready(() => {
    controlsDiv = document.getElementById('controls');

    showLoading();
    Promise.all([
      fetchJson(DATA_URL),
      fetchMapSvgPaths()
    ])
      .then(([rawData]) => {
        const urlState = parseUrlState();
        prepareData(rawData);
        setupModeSwitchListeners();
        switchMode(urlState.mode, urlState);
        suppressUrlUpdate = false;
        updateUrlFromControls();
      })
      .catch(showDataError);
  });

  function fetchJson(url) {
    return fetch(url).then(response => {
      if (!response.ok) {
        throw new Error(`データファイルを取得できませんでした（HTTP ${response.status}）。`);
      }
      return response.json();
    });
  }

  function fetchMapSvgPaths() {
    mapSvgLoadError = null;
    mapPrefecturePaths = [];

    return fetch(MAP_SVG_URL)
      .then(response => {
        if (!response.ok) {
          throw new Error(`地図SVGを取得できませんでした（HTTP ${response.status}）。`);
        }
        return response.text();
      })
      .then(svgText => {
        mapPrefecturePaths = extractLincunPrefecturePaths(svgText);
      })
      .catch(error => {
        mapSvgLoadError = error;
      });
  }

  function extractLincunPrefecturePaths(svgText) {
    const documentParser = new DOMParser();
    const svgDocument = documentParser.parseFromString(svgText, 'image/svg+xml');
    const parserError = svgDocument.querySelector('parsererror');
    if (parserError) throw new Error('地図SVGの解析に失敗しました。');

    const landGroup = Array.from(svgDocument.querySelectorAll('g'))
      .find(group => group.getAttribute('fill') === '#bbee66');
    const paths = landGroup
      ? Array.from(landGroup.querySelectorAll('path')).map(path => path.getAttribute('d')).filter(Boolean)
      : [];

    if (paths.length !== MAP_PREFECTURE_COUNT) {
      throw new Error(`地図SVGの都道府県パス数が想定と異なります（${paths.length}件）。`);
    }

    return paths;
  }

  function showLoading() {
    controlsDiv.innerHTML = '<p class="status-message">データを読み込んでいます。</p>';
  }

  function showDataError(error) {
    if (!controlsDiv) return;
    const localFileHint = window.location.protocol === 'file:'
      ? ' ローカルで確認する場合は、HTMLファイルを直接開くのではなく、HTTPサーバー経由で開いてください。GitHub Pagesではそのまま動作します。'
      : '';
    controlsDiv.innerHTML = `<p class="status-message error">${escapeHtml((error.message || 'データの読み込みに失敗しました。') + localFileHint)}</p>`;
  }

  function prepareData(rawData) {
    const labels = Array.isArray(rawData.labels) ? rawData.labels.map(String) : [];
    const labelIndexByYear = new Map(labels.map((label, index) => [label, index]));

    years = labels.slice().sort((a, b) => Number(a) - Number(b));
    materials = Array.isArray(rawData.materials) ? rawData.materials.slice() : Object.keys(rawData.data || {});
    universities = Array.isArray(rawData.universities) ? rawData.universities.slice() : [];
    metrics = {};

    materials.forEach(key => {
      metrics[key] = {};
      universities.forEach(university => {
        const series = rawData.data?.[key]?.[university] || [];
        metrics[key][university] = years.map(year => {
          const index = labelIndexByYear.get(year);
          return index === undefined ? null : series[index];
        });
      });
    });
  }

  function parseUrlState() {
    const params = new URLSearchParams(window.location.search);
    const mode = MODE_VALUES.includes(params.get('mode')) ? params.get('mode') : 'bar';
    const lineUniversities = splitParamList(params.get('unis') || params.get('lineUnis'));

    return {
      mode,
      year: params.get('year') || '',
      metric: params.get('metric') || '',
      x: params.get('x') || '',
      y: params.get('y') || '',
      highlight: params.get('highlight') || '',
      showReg: params.get('reg') === '1',
      showMedian: params.get('median') !== '0',
      xMax: params.get('xMax') || '',
      yMax: params.get('yMax') || '',
      top: BAR_LIMIT_VALUES.includes(params.get('top')) ? params.get('top') : 'all',
      rank: normalizeBarRankParam(params.get('rank')),
      mapStyle: MAP_STYLE_VALUES.includes(params.get('mapStyle')) ? params.get('mapStyle') : 'heat',
      lineUniversities
    };
  }

  function splitParamList(value) {
    if (!value) return [];
    return value.split(',').map(item => item.trim()).filter(Boolean);
  }

  function normalizeBarRankParam(value) {
    if (value === 'diff') return 'diffUp';
    if (value === 'rate') return 'rateUp';
    return BAR_RANK_VALUES.includes(value) ? value : 'value';
  }

  function setupModeSwitchListeners() {
    document.querySelectorAll('#modeSwitch input[name="mode"]').forEach(input => {
      input.onchange = () => {
        if (input.checked) switchMode(input.value);
      };
    });
  }

  function setModeActive() {
    document.querySelectorAll('#modeSwitch label').forEach(label => {
      label.classList.remove('active');
    });

    const activeInput = document.querySelector(`#modeSwitch input[value="${chartMode}"]`);
    if (activeInput) activeInput.parentElement.classList.add('active');
  }

  function renderControls(mode) {
    controlsDiv.innerHTML = '';

    if (mode === 'bar') {
      controlsDiv.innerHTML = `
        <div class="control-layout control-layout-bar">
          <section class="control-panel control-panel-primary">
            <h2 class="control-panel-title">表示条件</h2>
            <div class="control-field">
              <label for="barMetric">項目</label>
              <select id="barMetric" class="metric-select"></select>
            </div>
            <div class="control-row">
              <div class="control-field">
                <label for="barRank">表示内容</label>
                <select id="barRank">
                  <option value="value">値</option>
                  <option value="diffUp">前年差（増加）</option>
                  <option value="diffDown">前年差（減少）</option>
                  <option value="rateUp">増減率（増加）</option>
                  <option value="rateDown">増減率（減少）</option>
                </select>
              </div>
              <div class="control-field">
                <label for="barLimit">表示範囲</label>
                <select id="barLimit">
                  <option value="all">全件</option>
                  <option value="10">上位10件</option>
                  <option value="20">上位20件</option>
                  <option value="50">上位50件</option>
                </select>
              </div>
            </div>
            <div class="control-field year-field bar-year-field">
              <label for="yearSlider">年</label>
              <div class="year-control">
                <input id="yearSlider" type="range">
                <span id="yearLabel"></span>
              </div>
            </div>
          </section>
          <section class="control-panel control-panel-secondary">
            <h2 class="control-panel-title">都道府県</h2>
            <input type="hidden" id="barUniSelect" value="">
            <input id="barUniSearch" class="university-search" type="search" placeholder="都道府県名を検索">
            <div id="barUniList" class="university-checklist"></div>
            <div id="barUniSummary" class="selection-summary"></div>
          </section>
          <section class="control-panel control-actions-panel control-panel-output">
            <h2 class="control-panel-title">出力</h2>
            <div class="control-actions">
              <button type="button" id="shareUrl" class="secondary-button">URL共有</button>
              <button type="button" id="savePng">PNG保存</button>
            </div>
            <p id="shareUrlStatus" class="share-status" role="status" aria-live="polite"></p>
          </section>
        </div>
      `;
      return;
    }

    if (mode === 'scatter') {
      controlsDiv.innerHTML = `
        <div class="control-layout control-layout-scatter">
          <section class="control-panel control-panel-primary">
            <h2 class="control-panel-title">軸</h2>
            <div class="control-field">
              <label for="xSelect">X軸</label>
              <select id="xSelect" class="metric-select"></select>
            </div>
            <div class="control-field">
              <label for="ySelect">Y軸</label>
              <select id="ySelect" class="metric-select"></select>
            </div>
            <div class="control-row">
              <div class="control-field">
                <label for="xMax">X最大値</label>
                <input id="xMax" type="number" placeholder="自動">
              </div>
              <div class="control-field">
                <label for="yMax">Y最大値</label>
                <input id="yMax" type="number" placeholder="自動">
              </div>
            </div>
          </section>
          <section class="control-panel control-panel-compact">
            <h2 class="control-panel-title">表示</h2>
            <div class="control-field year-field">
              <label for="yearSlider">年</label>
              <div class="year-control">
                <input id="yearSlider" type="range">
                <span id="yearLabel"></span>
              </div>
            </div>
            <label class="inline-checkbox" for="showReg"><input id="showReg" type="checkbox"> 回帰直線</label>
            <label class="inline-checkbox" for="showMedian"><input id="showMedian" type="checkbox"> 中央値ライン</label>
            <div id="corrDisplay">相関係数: N/A</div>
          </section>
          <section class="control-panel control-panel-secondary">
            <h2 class="control-panel-title">都道府県</h2>
            <input type="hidden" id="uniSelect" value="">
            <input id="uniSearch" class="university-search" type="search" placeholder="都道府県名を検索">
            <div id="uniList" class="university-checklist"></div>
            <div id="uniSummary" class="selection-summary"></div>
          </section>
          <section class="control-panel control-actions-panel control-panel-output">
            <h2 class="control-panel-title">出力</h2>
            <div class="control-actions">
              <button type="button" id="resetZoom">リセット</button>
              <button type="button" id="shareUrl" class="secondary-button">URL共有</button>
              <button type="button" id="savePng">PNG保存</button>
            </div>
            <p id="shareUrlStatus" class="share-status" role="status" aria-live="polite"></p>
          </section>
        </div>
      `;
      return;
    }

    if (mode === 'map') {
      controlsDiv.innerHTML = `
        <div class="control-layout control-layout-map">
          <section class="control-panel control-panel-primary">
            <h2 class="control-panel-title">表示条件</h2>
            <div class="control-field">
              <label for="mapMetric">項目</label>
              <select id="mapMetric" class="metric-select"></select>
            </div>
            <div class="control-row">
              <div class="control-field">
                <label for="mapStyle">地図</label>
                <select id="mapStyle">
                  <option value="heat">ヒートマップ</option>
                  <option value="bars">棒を伸ばす</option>
                </select>
              </div>
              <div class="control-field year-field">
                <label for="yearSlider">年</label>
                <div class="year-control">
                  <input id="yearSlider" type="range">
                  <span id="yearLabel"></span>
                </div>
              </div>
            </div>
          </section>
          <section class="control-panel control-actions-panel control-panel-output">
            <h2 class="control-panel-title">出力</h2>
            <div class="control-actions">
              <button type="button" id="shareUrl" class="secondary-button">URL共有</button>
              <button type="button" id="savePng">PNG保存</button>
            </div>
            <p id="shareUrlStatus" class="share-status" role="status" aria-live="polite"></p>
          </section>
        </div>
      `;
      return;
    }

    if (mode === 'line') {
      controlsDiv.innerHTML = `
        <div class="control-layout control-layout-line">
          <section class="control-panel control-panel-primary">
            <h2 class="control-panel-title">表示条件</h2>
            <div class="control-field">
              <label for="lineMetric">項目</label>
              <select id="lineMetric" class="metric-select"></select>
            </div>
          </section>
          <section class="control-panel control-panel-secondary">
            <h2 class="control-panel-title">都道府県</h2>
            <input type="hidden" id="lineUni" value="">
            <input id="lineUniSearch" class="university-search" type="search" placeholder="都道府県名を検索">
            <div class="picker-toolbar">
              <button type="button" class="secondary-button" id="lineClearUniversities">選択解除</button>
            </div>
            <div id="lineUniList" class="university-checklist university-checklist-multi"></div>
            <div id="lineUniSummary" class="selection-summary"></div>
          </section>
          <section class="control-panel control-actions-panel control-panel-output">
            <h2 class="control-panel-title">出力</h2>
            <div class="control-actions">
              <button type="button" id="shareUrl" class="secondary-button">URL共有</button>
              <button type="button" id="savePng">PNG保存</button>
            </div>
            <p id="shareUrlStatus" class="share-status" role="status" aria-live="polite"></p>
          </section>
        </div>
      `;
    }
  }

  function showChartVisualization() {
    const canvas = document.getElementById('chart');
    const mapContainer = document.getElementById('mapContainer');
    const status = document.getElementById('visualizationStatus');
    const container = document.getElementById('chart-container');

    if (container) container.classList.remove('map-active');
    if (canvas) canvas.hidden = false;
    if (mapContainer) mapContainer.hidden = true;
    if (status) status.hidden = true;
  }

  function showMapVisualization() {
    const canvas = document.getElementById('chart');
    const mapContainer = document.getElementById('mapContainer');
    const status = document.getElementById('visualizationStatus');
    const container = document.getElementById('chart-container');

    if (container) container.classList.add('map-active');
    if (canvas) canvas.hidden = true;
    if (mapContainer) mapContainer.hidden = false;
    if (status) status.hidden = true;
  }

  function showVisualizationStatus(message) {
    const canvas = document.getElementById('chart');
    const mapContainer = document.getElementById('mapContainer');
    const status = document.getElementById('visualizationStatus');
    const container = document.getElementById('chart-container');

    destroyChart();
    if (container) container.classList.remove('map-active');
    if (canvas) canvas.hidden = true;
    if (mapContainer) mapContainer.hidden = true;
    if (status) {
      status.textContent = message;
      status.hidden = false;
    }
  }

  function ensureChartLibrary() {
    if (typeof Chart !== 'undefined') {
      showChartVisualization();
      return true;
    }

    showVisualizationStatus('Chart.jsを読み込めませんでした。棒グラフ・散布図・折れ線グラフを表示するには、ネットワーク接続またはCDNの読み込み設定を確認してください。');
    return false;
  }

  function drawBar() {
    if (!ensureChartLibrary()) return;

    const metricKey = document.getElementById('barMetric').value;
    const yearIndex = Number(document.getElementById('yearSlider').value);
    const year = years[yearIndex];
    const selectedUniversity = document.getElementById('barUniSelect').value;
    const barLimit = getBarLimit();
    const rankType = getBarRankType();
    const rankInfo = getBarRankInfo(rankType, yearIndex);

    const dataArr = universities
      .map(university => getBarRankItem(metricKey, university, yearIndex, rankType))
      .filter(item => Number.isFinite(item.value))
      .sort((a, b) => rankInfo.sortDirection * (b.value - a.value));
    dataArr.forEach((item, index) => {
      item.rank = index + 1;
    });
    const displayDataArr = barLimit === null ? dataArr : dataArr.slice(0, barLimit);

    const labels = displayDataArr.map(item => item.uni);
    const values = displayDataArr.map(item => item.value);
    const minValue = values.length ? Math.min(...values, 0) : 0;
    const maxValue = values.length ? Math.max(...values, 0) : 0;
    const valueRange = Math.max(1, maxValue - minValue);
    const suggestedMin = minValue < 0 ? minValue - valueRange * 0.08 : 0;
    const suggestedMax = maxValue > 0 ? maxValue + valueRange * 0.08 : 1;
    const comparisonText = rankType === 'value'
      ? ''
      : (rankInfo.previousYear ? `${year}年 - ${rankInfo.previousYear}年` : '前年データなし');
    const subtitleParts = [
      `${year}年`,
      rankInfo.label,
      comparisonText,
      getBarLimitLabel(),
      selectedUniversity ? `強調: ${selectedUniversity}` : '全都道府県'
    ].filter(Boolean);

    const normalBg = 'rgba(74,144,226,0.7)';
    const normalBd = 'rgba(74,144,226,1)';
    const positiveBg = 'rgba(40,161,122,0.72)';
    const positiveBd = 'rgba(40,161,122,1)';
    const negativeBg = 'rgba(217,79,112,0.72)';
    const negativeBd = 'rgba(217,79,112,1)';
    const fadedBg = 'rgba(74,144,226,0.2)';
    const fadedBd = 'rgba(74,144,226,0.3)';
    const highBg = 'rgba(255,205,56,0.8)';
    const highBd = 'rgba(255,205,56,1)';
    const bgColors = displayDataArr.map(item => {
      if (selectedUniversity) return item.uni === selectedUniversity ? highBg : fadedBg;
      if (rankType === 'value') return normalBg;
      return item.value >= 0 ? positiveBg : negativeBg;
    });
    const bdColors = displayDataArr.map(item => {
      if (selectedUniversity) return item.uni === selectedUniversity ? highBd : fadedBd;
      if (rankType === 'value') return normalBd;
      return item.value >= 0 ? positiveBd : negativeBd;
    });
    const bdWidths = displayDataArr.map(item => !selectedUniversity ? 1 : (item.uni === selectedUniversity ? 2 : 1));

    const ctx = document.getElementById('chart').getContext('2d');
    destroyChart();

    chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: `${metricKey}（${rankInfo.label}）`,
          data: values,
          details: displayDataArr,
          backgroundColor: bgColors,
          borderColor: bdColors,
          borderWidth: bdWidths
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { right: 24, bottom: 36 } },
        plugins: {
          ...getTitlePluginOptions(
            `都道府県別 ${metricKey}`,
            subtitleParts.join(' / ')
          ),
          legend: { display: false },
          datalabels: {
            color: context => {
              const detail = context.dataset.details?.[context.dataIndex];
              if (!detail) return 'rgba(74,144,226,1)';
              if (rankType === 'value') return 'rgba(74,144,226,1)';
              return detail.value >= 0 ? 'rgba(40,161,122,1)' : 'rgba(217,79,112,1)';
            },
            font: { size: 10 },
            anchor: 'end',
            align: context => {
              const value = context.dataset.data?.[context.dataIndex];
              return Number(value) < 0 ? 'start' : 'end';
            },
            formatter: value => formatBarRankValue(value, rankType)
          },
          tooltip: {
            callbacks: {
              title: items => items[0].label,
              label: item => {
                const detail = item.dataset.details?.[item.dataIndex];
                return `${rankInfo.label}: ${formatBarRankValue(item.parsed.y, rankType)}${detail?.rank ? `（${detail.rank}位）` : ''}`;
              },
              afterLabel: item => {
                const detail = item.dataset.details?.[item.dataIndex];
                if (!detail || rankType === 'value') return '';
                return [
                  `${year}年: ${formatNumber(detail.current)}`,
                  `${rankInfo.previousYear}年: ${formatNumber(detail.previous)}`
                ];
              }
            }
          }
        },
        scales: {
          x: {
            type: 'category',
            offset: true,
            bounds: 'data',
            grid: { offset: true },
            title: {
              display: true,
              text: rankInfo.axisLabel,
              align: 'center',
              font: { size: 12 }
            },
            ticks: {
              align: 'center',
              callback: function (value, index) { return this.getLabelForValue(index); },
              font: { size: 10 },
              autoSkip: false,
              labelOffset: -5,
              padding: -2,
              maxRotation: 90,
              minRotation: 90
            }
          },
          y: {
            beginAtZero: true,
            suggestedMin,
            suggestedMax,
            ticks: {
              callback: value => formatBarRankValue(Number(value), rankType)
            }
          }
        }
      },
      plugins: getChartPlugins()
    });

    updateUrlFromControls();
  }

  function drawScatter() {
    if (!ensureChartLibrary()) return;

    const xKey = document.getElementById('xSelect').value;
    const yKey = document.getElementById('ySelect').value;
    const yearIndex = Number(document.getElementById('yearSlider').value);
    const year = years[yearIndex];
    const selectedUniversity = document.getElementById('uniSelect').value;
    const showRegression = document.getElementById('showReg').checked;
    const showMedian = document.getElementById('showMedian').checked;
    const xMax = parsePositiveNumber(document.getElementById('xMax').value);
    const yMax = parsePositiveNumber(document.getElementById('yMax').value);

    const points = universities
      .map(university => ({
        x: getMetricNumber(xKey, university, yearIndex),
        y: getMetricNumber(yKey, university, yearIndex),
        uni: university
      }))
      .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));

    const xScale = {
      grid: { color: '#F0F0F0' },
      min: 0,
      title: { display: true, text: xKey, align: 'center', padding: { top: 10 } }
    };
    const yScale = {
      grid: { color: '#F0F0F0' },
      min: 0,
      title: { display: true, text: yKey, align: 'center', padding: { left: 10 }, rotation: -90 }
    };
    if (xMax !== null) xScale.max = xMax;
    if (yMax !== null) yScale.max = yMax;

    const regressionData = showRegression ? getRegressionLine(points, xScale.max) : [];
    const canShowRegression = regressionData.length > 0;
    const quadrant = showMedian ? getQuadrantOptions(points, xKey, yKey) : null;

    const ctx = document.getElementById('chart').getContext('2d');
    destroyChart();

    chart = new Chart(ctx, {
      type: 'scatter',
      data: {
        datasets: [
          {
            data: points,
            pointRadius: points.map(point => !selectedUniversity ? 5 : (point.uni === selectedUniversity ? 7 : 5)),
            backgroundColor: points.map(point => !selectedUniversity
              ? 'rgba(74,144,226,0.7)'
              : (point.uni === selectedUniversity ? 'rgba(255,205,56,0.8)' : 'rgba(74,144,226,0.2)')
            ),
            borderColor: points.map(point => !selectedUniversity
              ? 'rgba(74,144,226,1)'
              : (point.uni === selectedUniversity ? 'rgba(255,205,56,1)' : 'rgba(74,144,226,0.3)')
            )
          },
          {
            type: 'line',
            label: '回帰直線',
            data: regressionData,
            fill: false,
            borderColor: 'rgba(0,128,0,0.7)',
            borderWidth: 1,
            borderDash: [4, 4],
            pointRadius: 0,
            hidden: !canShowRegression,
            datalabels: { display: false }
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 12, right: 32, bottom: 36 } },
        scales: {
          x: xScale,
          y: yScale
        },
        plugins: {
          ...getTitlePluginOptions(
            `${yKey} と ${xKey} の散布図`,
            `${year}年 / ${selectedUniversity ? `強調: ${selectedUniversity}` : '全都道府県'}${showRegression ? ' / 回帰直線あり' : ''}${showMedian ? ' / 中央値ラインあり' : ''}`
          ),
          legend: { display: false },
          quadrant: {
            enabled: Boolean(quadrant),
            xMedian: quadrant?.xMedian,
            yMedian: quadrant?.yMedian,
            labels: quadrant?.labels
          },
          zoom: {
            limits: { x: { min: 0 }, y: { min: 0 } },
            pan: { enabled: true, mode: 'xy' },
            zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'xy' }
          },
          tooltip: {
            callbacks: {
              label: context => {
                const point = context.dataset.data[context.dataIndex];
                return point.uni
                  ? `${point.uni}: (${formatNumber(context.parsed.x)}, ${formatNumber(context.parsed.y)})`
                  : '';
              }
            }
          },
          datalabels: {
            align: 'end',
            anchor: 'end',
            font: { size: 10 },
            color: context => {
              const point = context.dataset.data[context.dataIndex];
              if (!point || !point.uni) return 'rgba(74,144,226,0)';
              return !selectedUniversity || point.uni === selectedUniversity
                ? 'rgba(74,144,226,1)'
                : 'rgba(74,144,226,0.3)';
            },
            formatter: value => value.uni || ''
          }
        }
      },
      plugins: getChartPlugins()
    });

    updateCorrelation(points);
    updateUrlFromControls();
  }

  function drawLine() {
    if (!ensureChartLibrary()) return;

    const selectedUniversities = getSelectedLineUniversities();
    const metric = document.getElementById('lineMetric').value;
    const datasets = selectedUniversities.map((university, index) => {
      const color = CHART_COLORS[index % CHART_COLORS.length];
      return {
        label: university === LINE_TOTAL_VALUE ? `合計（全都道府県）` : university,
        data: getLineSeries(metric, university),
        borderColor: color,
        backgroundColor: toTransparentColor(color, 0.12),
        pointBackgroundColor: color,
        pointRadius: 4,
        borderWidth: 2,
        spanGaps: true,
        tension: 0.15
      };
    });

    const finiteValues = datasets
      .flatMap(dataset => dataset.data)
      .filter(value => Number.isFinite(value));
    const maxValue = finiteValues.length ? Math.max(...finiteValues) : 0;
    const suggestedMax = maxValue > 0 ? Math.ceil(maxValue * 1.15) : 1;

    const ctx = document.getElementById('chart').getContext('2d');
    destroyChart();

    chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: years,
        datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { right: 72, bottom: 36 } },
        plugins: {
          ...getTitlePluginOptions(
            `${metric}の推移`,
            summarizeList(selectedUniversities.map(formatLineUniversityLabel), 5)
          ),
          legend: {
            display: true,
            position: 'top',
            labels: { boxWidth: 18 }
          },
          datalabels: {
            color: context => context.dataset.borderColor,
            font: { size: 10 },
            anchor: 'end',
            align: 'top',
            formatter: (value, context) => {
              if (context.dataIndex !== years.length - 1) return '';
              return Number.isFinite(value) ? formatNumber(value) : '';
            }
          },
          tooltip: {
            callbacks: {
              label: context => {
                const value = Number.isFinite(context.parsed.y) ? formatNumber(context.parsed.y) : '－';
                return `${context.dataset.label}: ${value}`;
              }
            }
          }
        },
        scales: {
          x: { title: { display: true, text: '年度' } },
          y: {
            beginAtZero: true,
            suggestedMax,
            title: { display: true, text: metric }
          }
        }
      },
      plugins: getChartPlugins()
    });

    updateUrlFromControls();
  }

  function drawMap() {
    const mapContainer = document.getElementById('mapContainer');
    if (!mapContainer) return;

    destroyChart();
    showMapVisualization();

    if (!hasLincunMapPaths()) {
      mapContainer.innerHTML = renderMapLoadError();
      updateUrlFromControls();
      return;
    }

    const metric = document.getElementById('mapMetric').value;
    const yearIndex = Number(document.getElementById('yearSlider').value);
    const year = years[yearIndex];
    const style = getMapStyle();
    const items = getMapItems(metric, yearIndex);
    const range = getMapValueRange(items.filter(item => Number.isFinite(item.value)));

    mapContainer.innerHTML = renderMapVisualization({
      items,
      metric,
      year,
      style,
      range
    });
    setupMapOverlay(items, range, style);
    setupMapInteractions(items, metric);
    updateUrlFromControls();
  }

  function hasLincunMapPaths() {
    return mapPrefecturePaths.length === MAP_PREFECTURE_COUNT;
  }

  function renderMapLoadError() {
    const message = mapSvgLoadError?.message || 'Japan_Map_Lincun.svgを読み込めませんでした。';
    return `
      <div class="map-view map-view-empty">
        <p class="status-message error">${escapeHtml(message)} ローカルで確認する場合は、HTTPサーバー経由で開いてください。</p>
      </div>
    `;
  }

  function getMapStyle() {
    const value = document.getElementById('mapStyle')?.value || 'heat';
    return MAP_STYLE_VALUES.includes(value) ? value : 'heat';
  }

  function getMapStyleLabel(style) {
    return style === 'bars' ? '棒を伸ばす' : 'ヒートマップ';
  }

  function getMapItems(metric, yearIndex) {
    return universities.map((name, index) => ({
      name,
      index,
      path: mapPrefecturePaths[index],
      value: getMetricNumber(metric, name, yearIndex)
    }));
  }

  function renderMapVisualization({ items, metric, year, style, range }) {
    const title = `都道府県別 ${metric}`;
    const subtitle = `${year}年 / ${getMapStyleLabel(style)} / 全都道府県`;

    return `
      <div class="map-view">
        <div class="map-title-row">
          <strong>${escapeHtml(title)}</strong>
          <span>${escapeHtml(subtitle)}</span>
        </div>
        <div class="map-stage">
          ${renderMapSvg({ items, metric, year, style, range, title, subtitle })}
          <div class="map-tooltip" role="status" hidden></div>
        </div>
        ${renderMapSummary(items, style)}
        <p class="map-source">${escapeHtml(getMapSourceText())}</p>
      </div>
    `;
  }

  function renderMapSvg({ items, style, range, title, subtitle }) {
    return `
      <svg class="japan-map-svg lincun-map-svg" viewBox="0 0 1024 1024" role="img" aria-labelledby="mapTitle mapDescription" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
        <title id="mapTitle">${escapeHtml(title)}</title>
        <desc id="mapDescription">${escapeHtml(subtitle)}</desc>
        ${renderLincunDefs()}
        <image class="map-base-image" href="${escapeHtml(getMapBaseHref())}" xlink:href="${escapeHtml(getMapBaseHref())}" x="0" y="0" width="1024" height="1024" preserveAspectRatio="xMidYMid meet" opacity="${style === 'bars' ? '0.5' : '0.42'}"></image>
        ${renderLincunPrefectureLayer(items, range, style)}
        <g id="mapOverlayLayer" class="map-overlay-layer" aria-hidden="true"></g>
        ${renderMapLegend(range, style)}
      </svg>
    `;
  }

  function renderLincunDefs() {
    return `
      <defs>
        <clipPath id="lincunMainClip">
          <path d="${LINCUN_MAIN_CLIP_PATH}"></path>
        </clipPath>
        <clipPath id="lincunSubClip">
          <path d="${LINCUN_SUB_CLIP_PATH}"></path>
        </clipPath>
        <linearGradient id="mapHeatGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#E9F2F4"></stop>
          <stop offset="50%" stop-color="#4FA88F"></stop>
          <stop offset="100%" stop-color="#C94C4C"></stop>
        </linearGradient>
        <filter id="mapLabelHalo" x="-40%" y="-40%" width="180%" height="180%">
          <feFlood flood-color="#FFFFFF" flood-opacity="0.92" result="bg"></feFlood>
          <feComposite in="bg" in2="SourceAlpha" operator="in"></feComposite>
          <feMerge>
            <feMergeNode></feMergeNode>
            <feMergeNode in="SourceGraphic"></feMergeNode>
          </feMerge>
        </filter>
      </defs>
    `;
  }

  function getMapBaseHref() {
    return new URL(MAP_SVG_URL, document.baseURI).href;
  }

  function renderLincunPrefectureLayer(items, range, style) {
    return items.map(item => renderLincunPrefecture(item, range, style)).join('');
  }

  function renderLincunPrefecture(item, range, style) {
    const hasValue = Number.isFinite(item.value);
    const color = hasValue ? getMapColor(item.value, range) : '#EFEFEF';
    const fill = color;
    const opacity = style === 'heat' ? 0.86 : 0.24;
    const stroke = 'rgba(34, 34, 34, 0.72)';
    const strokeWidth = 1.05;
    const ariaLabel = `${item.name}: ${hasValue ? formatNumber(item.value) : 'データなし'}`;

    return `
      <g class="map-prefecture" data-prefecture="${escapeHtml(item.name)}" tabindex="0" role="img" aria-label="${escapeHtml(ariaLabel)}">
        <title>${escapeHtml(ariaLabel)}</title>
        <g clip-path="url(#lincunMainClip)">
          ${renderLincunPrefecturePath(item, 'main', fill, opacity, stroke, strokeWidth)}
        </g>
        <g clip-path="url(#lincunSubClip)" transform="translate(${LINCUN_SUB_TRANSLATE_X} ${LINCUN_SUB_TRANSLATE_Y})">
          ${renderLincunPrefecturePath(item, 'sub', fill, opacity, stroke, strokeWidth)}
        </g>
      </g>
    `;
  }

  function renderLincunPrefecturePath(item, region, fill, opacity, stroke, strokeWidth) {
    return `
      <path
        class="map-prefecture-shape map-prefecture-${region}"
        data-prefecture="${escapeHtml(item.name)}"
        data-region="${region}"
        d="${item.path}"
        fill="${fill}"
        fill-opacity="${opacity}"
        stroke="${stroke}"
        stroke-width="${strokeWidth}"
        stroke-linejoin="round"
      ></path>
    `;
  }

  function setupMapOverlay(items, range, style) {
    const svg = document.querySelector('#mapContainer .japan-map-svg');
    const overlay = svg?.querySelector('#mapOverlayLayer');
    if (!svg || !overlay) return;

    const centers = items.map(item => ({
      item,
      center: getMapVisibleCenter(svg, item.name)
    })).filter(entry => entry.center);

    const rankedNames = items
      .filter(item => Number.isFinite(item.value))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5)
      .map(item => item.name);
    const labelNames = new Set(rankedNames);

    overlay.innerHTML = centers.map(({ item, center }) => {
      if (style === 'bars') return renderMapOverlayBar(item, center, range);
      if (!labelNames.has(item.name)) return '';
      return renderMapOverlayLabel(item, center, range);
    }).join('');
  }

  function getMapVisibleCenter(svg, prefecture) {
    if (MAP_CENTER_OVERRIDES[prefecture]) return MAP_CENTER_OVERRIDES[prefecture];

    const mainPath = svg.querySelector(`.map-prefecture-main[data-prefecture="${cssEscape(prefecture)}"]`);
    const subPath = svg.querySelector(`.map-prefecture-sub[data-prefecture="${cssEscape(prefecture)}"]`);
    const mainCenter = mainPath ? getPathCenter(mainPath, 0, 0) : null;

    if (mainCenter && mainCenter.x >= 0 && mainCenter.x <= 1024 && mainCenter.y >= 0 && mainCenter.y <= 1024) {
      return mainCenter;
    }

    return subPath ? getPathCenter(subPath, LINCUN_SUB_TRANSLATE_X, LINCUN_SUB_TRANSLATE_Y) : mainCenter;
  }

  function getPathCenter(path, offsetX, offsetY) {
    const box = path.getBBox();
    return {
      x: box.x + box.width / 2 + offsetX,
      y: box.y + box.height / 2 + offsetY,
      width: box.width,
      height: box.height
    };
  }

  function renderMapOverlayBar(item, center, range) {
    if (!Number.isFinite(item.value)) return '';

    const ratio = getMapRatio(item.value, range);
    const barHeight = Math.max(5, Math.round(ratio * 128));
    const barWidth = 12;
    const depth = 5;
    const capHeight = 5;
    const baseY = Math.max(38, center.y - 3);
    const x = center.x - barWidth / 2;
    const y = Math.max(22, baseY - barHeight);
    const adjustedHeight = baseY - y;
    const color = getMapColor(item.value, range);
    const darkColor = shadeHexColor(color, -0.24);
    const lightColor = shadeHexColor(color, 0.22);
    const valueLabel = formatCompactValue(item.value);

    return `
      <g class="map-bar" data-prefecture="${escapeHtml(item.name)}">
        <rect x="${x + 2}" y="${y + 4}" width="${barWidth + depth}" height="${adjustedHeight}" fill="rgba(0,0,0,0.14)" rx="2"></rect>
        <rect x="${x}" y="${y}" width="${barWidth}" height="${adjustedHeight}" fill="${color}" rx="2"></rect>
        <polygon points="${x + barWidth},${y} ${x + barWidth + depth},${y - capHeight} ${x + barWidth + depth},${baseY - capHeight} ${x + barWidth},${baseY}" fill="${darkColor}"></polygon>
        <polygon points="${x},${y} ${x + barWidth},${y} ${x + barWidth + depth},${y - capHeight} ${x + depth},${y - capHeight}" fill="${lightColor}"></polygon>
        ${ratio > 0.72 ? `<text x="${center.x}" y="${Math.max(16, y - 24)}" text-anchor="middle" fill="#222222" font-family="sans-serif" font-size="13" font-weight="700" filter="url(#mapLabelHalo)">${escapeHtml(valueLabel)}</text>` : ''}
      </g>
    `;
  }

  function renderMapOverlayLabel(item, center, range) {
    const color = getMapColor(item.value, range);
    const radius = 9;

    return `
      <g class="map-label-pin" data-prefecture="${escapeHtml(item.name)}">
        <circle cx="${center.x}" cy="${center.y}" r="${radius}" fill="${color}" stroke="#FFFFFF" stroke-width="3" opacity="0.88"></circle>
        <text x="${center.x}" y="${center.y - radius - 7}" text-anchor="middle" fill="#222222" font-family="sans-serif" font-size="14" font-weight="700" filter="url(#mapLabelHalo)">${escapeHtml(item.name)}</text>
      </g>
    `;
  }

  function cssEscape(value) {
    if (window.CSS?.escape) return CSS.escape(value);
    return String(value).replace(/["\\]/g, '\\$&');
  }

  function renderMapLegend(range, style) {
    const x = 28;
    const y = 28;
    const legendWidth = 205;
    const minText = Number.isFinite(range.min) ? formatCompactValue(range.min) : 'N/A';
    const maxText = Number.isFinite(range.max) ? formatCompactValue(range.max) : 'N/A';

    return `
      <g class="map-legend">
        <rect x="${x}" y="${y}" width="250" height="78" fill="rgba(255,255,255,0.84)" stroke="rgba(80, 96, 104, 0.22)" rx="8"></rect>
        <text x="${x + 14}" y="${y + 23}" fill="#334047" font-family="sans-serif" font-size="15" font-weight="700">${style === 'bars' ? '棒の高さ・色' : '色の濃淡'}</text>
        <rect x="${x + 14}" y="${y + 36}" width="${legendWidth}" height="13" fill="url(#mapHeatGradient)" rx="6"></rect>
        <text x="${x + 14}" y="${y + 65}" fill="#556166" font-family="sans-serif" font-size="12">${escapeHtml(minText)}</text>
        <text x="${x + 14 + legendWidth}" y="${y + 65}" fill="#556166" font-family="sans-serif" font-size="12" text-anchor="end">${escapeHtml(maxText)}</text>
      </g>
    `;
  }

  function renderMapSummary(items, style) {
    const finiteItems = items
      .filter(item => Number.isFinite(item.value))
      .sort((a, b) => b.value - a.value);

    if (!finiteItems.length) {
      return '<div class="map-summary"><span>表示できるデータがありません。</span></div>';
    }

    const max = finiteItems[0];
    const min = finiteItems[finiteItems.length - 1];
    const median = getMedian(finiteItems.map(item => item.value));
    const topItems = finiteItems.slice(0, 5);

    return `
      <div class="map-summary">
        <span>最大 <strong>${escapeHtml(max.name)}</strong> ${escapeHtml(formatNumber(max.value))}</span>
        <span>最小 <strong>${escapeHtml(min.name)}</strong> ${escapeHtml(formatNumber(min.value))}</span>
        <span>中央値 ${escapeHtml(formatNumber(Math.round(median * 10) / 10))}</span>
        <span>表示 ${escapeHtml(getMapStyleLabel(style))}</span>
      </div>
      <ol class="map-ranking" aria-label="上位5都道府県">
        ${topItems.map(item => `<li><span>${escapeHtml(item.name)}</span><strong>${escapeHtml(formatCompactValue(item.value))}</strong></li>`).join('')}
      </ol>
    `;
  }

  function getMapValueRange(items) {
    const values = items.map(item => item.value).filter(Number.isFinite);
    if (!values.length) return { min: NaN, max: NaN };

    const min = Math.min(...values);
    const max = Math.max(...values);
    if (min === max) return { min: min - 1, max: max + 1 };
    return { min, max };
  }

  function getMapRatio(value, range) {
    if (!Number.isFinite(value) || !Number.isFinite(range.min) || !Number.isFinite(range.max)) return 0;
    return Math.max(0, Math.min(1, (value - range.min) / (range.max - range.min)));
  }

  function getMapColor(value, range) {
    if (!Number.isFinite(value)) return '#EFEFEF';

    const ratio = getMapRatio(value, range);
    const stops = [
      { stop: 0, color: [233, 242, 244] },
      { stop: 0.5, color: [79, 168, 143] },
      { stop: 1, color: [201, 76, 76] }
    ];
    const upperIndex = stops.findIndex(item => ratio <= item.stop);
    const upper = stops[Math.max(upperIndex, 1)];
    const lower = stops[Math.max(0, stops.indexOf(upper) - 1)];
    const localRatio = (ratio - lower.stop) / (upper.stop - lower.stop);
    const rgb = lower.color.map((channel, index) => Math.round(channel + (upper.color[index] - channel) * localRatio));

    return rgbToHex(rgb);
  }

  function rgbToHex(rgb) {
    return `#${rgb.map(channel => channel.toString(16).padStart(2, '0')).join('')}`;
  }

  function shadeHexColor(hex, amount) {
    const value = hex.replace('#', '');
    const rgb = [0, 2, 4].map(index => parseInt(value.slice(index, index + 2), 16));
    const shaded = rgb.map(channel => {
      const target = amount >= 0 ? 255 : 0;
      return Math.round(channel + (target - channel) * Math.abs(amount));
    });
    return rgbToHex(shaded);
  }

  function getReadableTextColor(hex) {
    const value = hex.replace('#', '');
    const r = parseInt(value.slice(0, 2), 16);
    const g = parseInt(value.slice(2, 4), 16);
    const b = parseInt(value.slice(4, 6), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.58 ? '#263238' : '#FFFFFF';
  }

  function setupMapInteractions(items, metric) {
    const mapContainer = document.getElementById('mapContainer');
    const tooltip = mapContainer?.querySelector('.map-tooltip');
    if (!mapContainer || !tooltip) return;

    const itemByName = new Map(items.map(item => [item.name, item]));

    mapContainer.querySelectorAll('.map-prefecture').forEach(node => {
      const prefecture = node.dataset.prefecture;
      const item = itemByName.get(prefecture);
      if (!item) return;

      node.addEventListener('mouseenter', event => {
        setMapTooltipContent(tooltip, item, metric);
        positionMapTooltip(mapContainer, tooltip, event);
        tooltip.hidden = false;
      });
      node.addEventListener('mousemove', event => {
        positionMapTooltip(mapContainer, tooltip, event);
      });
      node.addEventListener('mouseleave', () => {
        tooltip.hidden = true;
      });
      node.addEventListener('focus', event => {
        setMapTooltipContent(tooltip, item, metric);
        positionMapTooltipFromElement(mapContainer, tooltip, event.currentTarget);
        tooltip.hidden = false;
      });
      node.addEventListener('blur', () => {
        tooltip.hidden = true;
      });
    });
  }

  function setMapTooltipContent(tooltip, item, metric) {
    const value = Number.isFinite(item.value) ? formatNumber(item.value) : 'データなし';
    tooltip.innerHTML = `
      <strong>${escapeHtml(item.name)}</strong>
      <span>${escapeHtml(metric)}</span>
      <b>${escapeHtml(value)}</b>
    `;
  }

  function positionMapTooltip(mapContainer, tooltip, event) {
    const rect = mapContainer.getBoundingClientRect();
    const left = event.clientX - rect.left + 14;
    const top = event.clientY - rect.top + 14;
    setMapTooltipPosition(mapContainer, tooltip, left, top);
  }

  function positionMapTooltipFromElement(mapContainer, tooltip, element) {
    const containerRect = mapContainer.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    const left = elementRect.left - containerRect.left + elementRect.width / 2;
    const top = elementRect.top - containerRect.top + elementRect.height / 2;
    setMapTooltipPosition(mapContainer, tooltip, left, top);
  }

  function setMapTooltipPosition(mapContainer, tooltip, left, top) {
    const maxLeft = Math.max(12, mapContainer.clientWidth - tooltip.offsetWidth - 12);
    const maxTop = Math.max(12, mapContainer.clientHeight - tooltip.offsetHeight - 12);
    tooltip.style.left = `${Math.min(Math.max(12, left), maxLeft)}px`;
    tooltip.style.top = `${Math.min(Math.max(12, top), maxTop)}px`;
  }

  function getLineSeries(metric, university) {
    if (university === LINE_TOTAL_VALUE) return getTotalSeries(metric);
    return years.map((year, index) => {
      const value = getMetricNumber(metric, university, index);
      return Number.isFinite(value) ? value : null;
    });
  }

  function setupListeners(mode) {
    setupShareUrlButton();

    if (mode === 'bar') {
      document.getElementById('barMetric').onchange = drawBar;
      document.getElementById('barRank').onchange = drawBar;
      document.getElementById('barLimit').onchange = drawBar;
      document.getElementById('yearSlider').oninput = function () {
        document.getElementById('yearLabel').textContent = years[this.value];
        drawBar();
      };
      document.getElementById('savePng').onclick = () => {
        saveChart(`bar_${document.getElementById('barMetric').value}_${getBarRankType()}_${document.getElementById('yearLabel').textContent}.png`);
      };
      return;
    }

    if (mode === 'scatter') {
      ['xSelect', 'ySelect', 'xMax', 'yMax', 'showReg', 'showMedian'].forEach(id => {
        document.getElementById(id).onchange = drawScatter;
      });
      document.getElementById('yearSlider').oninput = function () {
        document.getElementById('yearLabel').textContent = years[this.value];
        drawScatter();
      };
      document.getElementById('resetZoom').onclick = resetScatterView;
      document.getElementById('savePng').onclick = () => {
        saveChart(`scatter_${document.getElementById('yearLabel').textContent}.png`);
      };
      return;
    }

    if (mode === 'map') {
      document.getElementById('mapMetric').onchange = drawMap;
      document.getElementById('mapStyle').onchange = drawMap;
      document.getElementById('yearSlider').oninput = function () {
        document.getElementById('yearLabel').textContent = years[this.value];
        drawMap();
      };
      document.getElementById('savePng').onclick = () => {
        saveMap(`map_${getMapStyle()}_${document.getElementById('mapMetric').value}_${document.getElementById('yearLabel').textContent}.png`);
      };
      return;
    }

    if (mode === 'line') {
      document.getElementById('lineMetric').onchange = drawLine;
      document.getElementById('lineClearUniversities').onclick = () => {
        setUniversityPickerValues('lineUni', [LINE_TOTAL_VALUE]);
        drawLine();
      };
      document.getElementById('savePng').onclick = () => {
        saveChart(`line_${document.getElementById('lineMetric').value}_${getSelectedLineUniversities().join('_')}.png`);
      };
    }
  }

  function switchMode(newMode, state = {}) {
    state = {
      year: '',
      metric: '',
      x: '',
      y: '',
      highlight: '',
      showReg: false,
      showMedian: true,
      xMax: '',
      yMax: '',
      top: 'all',
      rank: 'value',
      mapStyle: 'heat',
      lineUniversities: [],
      ...state
    };
    if (!Array.isArray(state.lineUniversities)) state.lineUniversities = [];

    chartMode = MODE_VALUES.includes(newMode) ? newMode : 'bar';
    window.chartMode = chartMode;
    renderControls(chartMode);

    if (chartMode === 'bar') {
      const barMetricSelect = document.getElementById('barMetric');
      const barRankSelect = document.getElementById('barRank');
      const barLimitSelect = document.getElementById('barLimit');
      populateMetricSelect(barMetricSelect, materials);
      setSelectValue(barMetricSelect, state.metric);
      setSelectValue(barRankSelect, state.rank, 'value');
      setSelectValue(barLimitSelect, state.top, 'all');
      setupUniversityPicker({
        key: 'barUni',
        mode: 'single',
        values: universities,
        selectedValues: state.highlight ? [state.highlight] : [],
        allowNone: true,
        onChange: drawBar
      });
      setupYearSlider(state.year);
      setupListeners('bar');
      drawBar();
    } else if (chartMode === 'scatter') {
      const xSelect = document.getElementById('xSelect');
      const ySelect = document.getElementById('ySelect');
      const showReg = document.getElementById('showReg');
      const showMedian = document.getElementById('showMedian');

      populateMetricSelect(xSelect, materials);
      populateMetricSelect(ySelect, materials);
      setSelectValue(xSelect, state.x);
      setSelectValue(ySelect, state.y, getDefaultScatterYMetric(xSelect.value, state.year));
      document.getElementById('xMax').value = state.xMax || '';
      document.getElementById('yMax').value = state.yMax || '';
      showReg.checked = Boolean(state.showReg);
      showMedian.checked = state.showMedian !== false;
      setupUniversityPicker({
        key: 'uni',
        mode: 'single',
        values: universities,
        selectedValues: state.highlight ? [state.highlight] : [],
        allowNone: true,
        onChange: drawScatter
      });
      setupYearSlider(state.year);
      setupListeners('scatter');
      drawScatter();
    } else if (chartMode === 'map') {
      const mapMetricSelect = document.getElementById('mapMetric');
      const mapStyleSelect = document.getElementById('mapStyle');
      populateMetricSelect(mapMetricSelect, materials);
      setSelectValue(mapMetricSelect, state.metric);
      setSelectValue(mapStyleSelect, state.mapStyle, 'heat');
      setupYearSlider(state.year);
      setupListeners('map');
      drawMap();
    } else if (chartMode === 'line') {
      const metricSelect = document.getElementById('lineMetric');
      populateMetricSelect(metricSelect, materials);
      setSelectValue(metricSelect, state.metric);
      setupUniversityPicker({
        key: 'lineUni',
        mode: 'multiple',
        values: [LINE_TOTAL_VALUE].concat(universities),
        selectedValues: state.lineUniversities.length ? state.lineUniversities : [LINE_TOTAL_VALUE],
        allowNone: false,
        onChange: drawLine
      });
      setupListeners('line');
      drawLine();
    }

    setupShareUrlButton();

    const activeInput = document.querySelector(`#modeSwitch input[value="${chartMode}"]`);
    if (activeInput) activeInput.checked = true;
    setModeActive();
  }

  function resetScatterView() {
    const xMax = document.getElementById('xMax');
    const yMax = document.getElementById('yMax');
    if (xMax) xMax.value = '';
    if (yMax) yMax.value = '';

    if (chart && typeof chart.resetZoom === 'function') {
      chart.resetZoom();
    }

    drawScatter();
  }

  function setupYearSlider(preferredYear = '') {
    const yearSlider = document.getElementById('yearSlider');
    const defaultIndex = getYearIndex(preferredYear);
    yearSlider.min = 0;
    yearSlider.max = Math.max(0, years.length - 1);
    yearSlider.value = defaultIndex;
    document.getElementById('yearLabel').textContent = years[defaultIndex] || '';
  }

  function populateMetricSelect(select, values) {
    const grouped = new Map(METRIC_CATEGORY_ORDER.map(category => [category, []]));
    values.forEach(value => {
      const category = getMetricCategory(value);
      if (!grouped.has(category)) grouped.set(category, []);
      grouped.get(category).push(value);
    });

    grouped.forEach((categoryValues, category) => {
      if (!categoryValues.length) return;
      const group = document.createElement('optgroup');
      group.label = category;
      categoryValues.forEach(value => appendOption(group, value, value));
      select.appendChild(group);
    });
  }

  function getMetricCategory(metric) {
    if (/予算|決算|資料費|図書費/.test(metric)) return '経費';
    if (/貸出|予約|登録/.test(metric)) return '利用';
    if (/蔵書|受入/.test(metric)) return '蔵書・受入';
    if (/職員/.test(metric)) return '職員';
    if (/図書館数|自動車図書館/.test(metric)) return '図書館数';
    if (/自治体|設置/.test(metric)) return '設置自治体';
    if (/人口/.test(metric)) return '基本';
    return 'その他';
  }

  function appendOption(select, value, label) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  }

  function setSelectValue(select, value, fallbackValue) {
    const optionValues = Array.from(select.options).map(option => option.value);
    if (value && optionValues.includes(value)) {
      select.value = value;
      return;
    }

    if (fallbackValue !== undefined && optionValues.includes(fallbackValue)) {
      select.value = fallbackValue;
      return;
    }

    if (select.options.length > 0) select.selectedIndex = 0;
  }

  function getPickerIds(key) {
    return {
      barUni: {
        hiddenId: 'barUniSelect',
        searchId: 'barUniSearch',
        listId: 'barUniList',
        summaryId: 'barUniSummary'
      },
      uni: {
        hiddenId: 'uniSelect',
        searchId: 'uniSearch',
        listId: 'uniList',
        summaryId: 'uniSummary'
      },
      lineUni: {
        hiddenId: 'lineUni',
        searchId: 'lineUniSearch',
        listId: 'lineUniList',
        summaryId: 'lineUniSummary'
      }
    }[key];
  }

  function setupUniversityPicker({ key, mode, values, selectedValues, allowNone, onChange }) {
    const ids = getPickerIds(key);
    const hidden = document.getElementById(ids.hiddenId);
    const search = document.getElementById(ids.searchId);
    const validValues = new Set(values);
    const normalized = selectedValues.filter(value => validValues.has(value));
    const initialValues = normalized.length ? normalized : (allowNone ? [] : [LINE_TOTAL_VALUE]);

    hidden.dataset.pickerKey = key;
    hidden.dataset.pickerMode = mode;
    hidden.value = initialValues.join(',');
    universityPickerConfigs[key] = { key, mode, values, allowNone, onChange };

    const render = () => {
      renderUniversityPickerOptions({ key, mode, values, allowNone, onChange });
      renderUniversitySummary(key);
    };

    search.oninput = render;
    render();
  }

  function renderUniversityPickerOptions({ key, mode, values, allowNone, onChange }) {
    const ids = getPickerIds(key);
    const hidden = document.getElementById(ids.hiddenId);
    const search = document.getElementById(ids.searchId);
    const list = document.getElementById(ids.listId);
    const query = normalizeSearchText(search.value);
    const selectedValues = new Set(splitParamList(hidden.value));
    const options = [];

    if (allowNone) options.push({ value: '', label: '選択なし' });
    values.forEach(value => options.push({ value, label: formatLineUniversityLabel(value) }));

    list.innerHTML = '';
    options
      .filter(option => !query || normalizeSearchText(option.label).includes(query))
      .forEach(option => {
        const label = document.createElement('label');
        label.className = 'checklist-option';

        const input = document.createElement('input');
        input.type = mode === 'single' ? 'radio' : 'checkbox';
        input.name = `${key}Option`;
        input.value = option.value;
        input.checked = mode === 'single'
          ? (option.value === '' ? selectedValues.size === 0 : selectedValues.has(option.value))
          : selectedValues.has(option.value);

        input.onchange = () => {
          if (mode === 'single') {
            hidden.value = input.value;
          } else {
            const nextValues = new Set(splitParamList(hidden.value));
            if (input.checked) nextValues.add(input.value);
            else nextValues.delete(input.value);
            if (!nextValues.size) nextValues.add(LINE_TOTAL_VALUE);
            hidden.value = Array.from(nextValues).filter(Boolean).join(',');
          }
          renderUniversityPickerOptions({ key, mode, values, allowNone, onChange });
          renderUniversitySummary(key);
          onChange();
        };

        const text = document.createElement('span');
        text.textContent = option.label;
        label.appendChild(input);
        label.appendChild(text);
        list.appendChild(label);
      });

    if (!list.children.length) {
      const empty = document.createElement('p');
      empty.className = 'checklist-empty';
      empty.textContent = '該当なし';
      list.appendChild(empty);
    }
  }

  function renderUniversitySummary(key) {
    const ids = getPickerIds(key);
    const hidden = document.getElementById(ids.hiddenId);
    const summary = document.getElementById(ids.summaryId);
    const values = splitParamList(hidden.value);

    summary.innerHTML = '';
    if (!values.length) {
      summary.textContent = '強調: なし';
      return;
    }

    values.forEach(value => {
      const chip = document.createElement('span');
      chip.className = 'selection-chip';
      chip.textContent = formatLineUniversityLabel(value);
      summary.appendChild(chip);
    });
  }

  function setUniversityPickerValues(key, values) {
    const ids = getPickerIds(key);
    const hidden = document.getElementById(ids.hiddenId);
    const config = universityPickerConfigs[key];
    hidden.value = values.join(',');
    document.getElementById(ids.searchId).value = '';
    if (config) renderUniversityPickerOptions(config);
    renderUniversitySummary(key);
  }

  function normalizeSearchText(value) {
    return String(value).toLowerCase().replace(/\s+/g, '');
  }

  function getYearIndex(preferredYear = '') {
    const requestedIndex = years.indexOf(String(preferredYear));
    if (requestedIndex >= 0) return requestedIndex;
    return Math.max(0, years.length - 1);
  }

  function getDefaultScatterYMetric(xMetric, preferredYear = '') {
    const yearIndex = getYearIndex(preferredYear);
    const metricWithData = materials.find(metric => metric !== xMetric && hasMetricData(metric, yearIndex));
    return metricWithData || materials.find(metric => metric !== xMetric) || materials[0];
  }

  function hasMetricData(metric, yearIndex) {
    return universities.some(university => Number.isFinite(getMetricNumber(metric, university, yearIndex)));
  }

  function getBarLimit() {
    const value = document.getElementById('barLimit')?.value || 'all';
    return value === 'all' ? null : Number(value);
  }

  function getBarLimitLabel() {
    const limit = getBarLimit();
    return limit === null ? '全件' : `上位${limit}件`;
  }

  function getBarRankType() {
    const value = document.getElementById('barRank')?.value || 'value';
    return BAR_RANK_VALUES.includes(value) ? value : 'value';
  }

  function getBarRankInfo(rankType, yearIndex) {
    const previousYear = yearIndex > 0 ? years[yearIndex - 1] : '';
    const info = {
      value: {
        label: '値',
        axisLabel: '値',
        sortDirection: 1,
        previousYear
      },
      diffUp: {
        label: '前年差（増加順）',
        axisLabel: '前年差',
        sortDirection: 1,
        previousYear
      },
      diffDown: {
        label: '前年差（減少順）',
        axisLabel: '前年差',
        sortDirection: -1,
        previousYear
      },
      rateUp: {
        label: '増減率（増加順）',
        axisLabel: '増減率',
        sortDirection: 1,
        previousYear
      },
      rateDown: {
        label: '増減率（減少順）',
        axisLabel: '増減率',
        sortDirection: -1,
        previousYear
      }
    };

    return info[rankType] || info.value;
  }

  function getBarRankItem(metric, university, yearIndex, rankType) {
    const current = getMetricNumber(metric, university, yearIndex);
    if (!Number.isFinite(current)) {
      return { uni: university, value: NaN, current, previous: NaN };
    }

    if (rankType === 'value') {
      return { uni: university, value: current, current, previous: NaN };
    }

    const previous = yearIndex > 0 ? getMetricNumber(metric, university, yearIndex - 1) : NaN;
    if (!Number.isFinite(previous)) {
      return { uni: university, value: NaN, current, previous };
    }

    const diff = current - previous;
    if (rankType === 'diffUp' || rankType === 'diffDown') {
      return { uni: university, value: diff, current, previous };
    }

    if (previous === 0) {
      return { uni: university, value: NaN, current, previous };
    }

    return { uni: university, value: (diff / previous) * 100, current, previous };
  }

  function getMetricNumber(metric, university, yearIndex) {
    const value = metrics[metric]?.[university]?.[yearIndex];
    const numberValue = parseFloat(value);
    return Number.isFinite(numberValue) ? numberValue : NaN;
  }

  function getTotalSeries(metric) {
    return years.map((year, yearIndex) => {
      let sum = 0;
      let count = 0;

      universities.forEach(university => {
        const value = getMetricNumber(metric, university, yearIndex);
        if (Number.isFinite(value)) {
          sum += value;
          count += 1;
        }
      });

      return count === 0 ? null : sum;
    });
  }

  function getSelectedLineUniversities() {
    const input = document.getElementById('lineUni');
    if (!input) return [LINE_TOTAL_VALUE];
    const selected = splitParamList(input.value);
    return selected.length ? selected : [LINE_TOTAL_VALUE];
  }

  function updateCorrelation(points) {
    const display = document.getElementById('corrDisplay');
    const correlation = getCorrelation(points);
    display.textContent = Number.isFinite(correlation)
      ? `相関係数: ${correlation.toFixed(2)}`
      : '相関係数: N/A';
  }

  function getCorrelation(points) {
    if (points.length < 2) return NaN;

    const xs = points.map(point => point.x);
    const ys = points.map(point => point.y);
    const n = points.length;
    const meanX = xs.reduce((sum, value) => sum + value, 0) / n;
    const meanY = ys.reduce((sum, value) => sum + value, 0) / n;
    const covSum = xs.reduce((sum, value, index) => sum + (value - meanX) * (ys[index] - meanY), 0);
    const varX = xs.reduce((sum, value) => sum + (value - meanX) ** 2, 0);
    const varY = ys.reduce((sum, value) => sum + (value - meanY) ** 2, 0);

    if (varX === 0 || varY === 0) return NaN;
    return (covSum / n) / (Math.sqrt(varX / n) * Math.sqrt(varY / n));
  }

  function getRegressionLine(points, requestedMaxX) {
    if (points.length < 2) return [];

    const xs = points.map(point => point.x);
    const ys = points.map(point => point.y);
    const n = points.length;
    const meanX = xs.reduce((sum, value) => sum + value, 0) / n;
    const meanY = ys.reduce((sum, value) => sum + value, 0) / n;
    const covSum = xs.reduce((sum, value, index) => sum + (value - meanX) * (ys[index] - meanY), 0);
    const varSum = xs.reduce((sum, value) => sum + (value - meanX) ** 2, 0);

    if (varSum === 0) return [];

    const slope = covSum / varSum;
    const intercept = meanY - slope * meanX;
    const maxX = Number.isFinite(requestedMaxX) ? requestedMaxX : Math.max(...xs);

    return [
      { x: 0, y: intercept },
      { x: maxX, y: intercept + slope * maxX }
    ];
  }

  function getQuadrantOptions(points) {
    if (points.length < 2) return null;

    const xMedian = getMedian(points.map(point => point.x));
    const yMedian = getMedian(points.map(point => point.y));
    if (!Number.isFinite(xMedian) || !Number.isFinite(yMedian)) return null;

    return {
      xMedian,
      yMedian,
      labels: {
        topLeft: 'X低・Y高',
        topRight: 'X高・Y高',
        bottomLeft: 'X低・Y低',
        bottomRight: 'X高・Y低'
      }
    };
  }

  function getMedian(values) {
    const sortedValues = values
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    const length = sortedValues.length;
    if (!length) return NaN;

    const center = Math.floor(length / 2);
    if (length % 2) return sortedValues[center];
    return (sortedValues[center - 1] + sortedValues[center]) / 2;
  }

  function updateUrlFromControls() {
    if (suppressUrlUpdate) return;

    const params = new URLSearchParams();
    params.set('mode', chartMode);

    if (chartMode === 'bar') {
      params.set('metric', document.getElementById('barMetric').value);
      params.set('year', document.getElementById('yearLabel').textContent);
      const rank = document.getElementById('barRank').value;
      const top = document.getElementById('barLimit').value;
      const highlight = document.getElementById('barUniSelect').value;
      if (rank !== 'value') params.set('rank', rank);
      if (top !== 'all') params.set('top', top);
      if (highlight) params.set('highlight', highlight);
    } else if (chartMode === 'scatter') {
      params.set('x', document.getElementById('xSelect').value);
      params.set('y', document.getElementById('ySelect').value);
      params.set('year', document.getElementById('yearLabel').textContent);
      const highlight = document.getElementById('uniSelect').value;
      const xMax = document.getElementById('xMax').value;
      const yMax = document.getElementById('yMax').value;
      if (highlight) params.set('highlight', highlight);
      if (document.getElementById('showReg').checked) params.set('reg', '1');
      if (!document.getElementById('showMedian').checked) params.set('median', '0');
      if (xMax) params.set('xMax', xMax);
      if (yMax) params.set('yMax', yMax);
    } else if (chartMode === 'map') {
      params.set('metric', document.getElementById('mapMetric').value);
      params.set('year', document.getElementById('yearLabel').textContent);
      const mapStyle = getMapStyle();
      if (mapStyle !== 'heat') params.set('mapStyle', mapStyle);
    } else if (chartMode === 'line') {
      params.set('metric', document.getElementById('lineMetric').value);
      params.set('unis', getSelectedLineUniversities().join(','));
    }

    const base = window.location.href.split('#')[0].split('?')[0];
    const hash = window.location.hash || '';
    window.history.replaceState(null, '', `${base}?${params.toString()}${hash}`);
  }

  function setupShareUrlButton() {
    const button = document.getElementById('shareUrl');
    if (!button) return;
    if (button.dataset.shareReady === '1') return;

    button.dataset.shareReady = '1';
    button.addEventListener('click', handleShareUrl);
  }

  async function handleShareUrl() {
    const button = document.getElementById('shareUrl');
    if (!button) return;

    updateUrlFromControls();
    button.disabled = true;
    setShareStatus('URLをコピーしています。', false, 0);

    try {
      await copyTextToClipboard(window.location.href);
      setShareStatus('URLをコピーしました。');
    } catch (error) {
      setShareStatus('URLをコピーできませんでした。アドレスバーからコピーしてください。', true);
    } finally {
      button.disabled = false;
    }
  }

  async function copyTextToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '0';
    document.body.appendChild(textarea);
    textarea.select();

    try {
      if (!document.execCommand('copy')) {
        throw new Error('Copy command was not accepted.');
      }
    } finally {
      textarea.remove();
    }
  }

  function setShareStatus(message, isError = false, clearAfter = 3000) {
    const status = document.getElementById('shareUrlStatus');
    if (!status) return;

    status.textContent = message;
    status.classList.toggle('error', isError);

    clearTimeout(shareStatusTimer);
    if (!clearAfter) return;

    shareStatusTimer = window.setTimeout(() => {
      status.textContent = '';
      status.classList.remove('error');
    }, clearAfter);
  }

  function getTitlePluginOptions(title, subtitle) {
    return {
      title: {
        display: true,
        text: title,
        color: '#222',
        font: { size: 17, weight: 'bold' },
        padding: { top: 4, bottom: 4 }
      },
      subtitle: {
        display: Boolean(subtitle),
        text: subtitle || '',
        color: '#555',
        font: { size: 12 },
        padding: { bottom: 12 }
      }
    };
  }

  function getMapSourceText() {
    return MAP_SOURCE_TEXT;
  }

  function getSourceText() {
    if (chartMode === 'map') {
      return getMapSourceText();
    }

    if (chartMode === 'line') {
      return '出典: 「日本の図書館 統計と名簿」（日本図書館協会）、人口推計（e-Stat）を加工して作成';
    }

    const yearLabel = document.getElementById('yearLabel');
    const yearText = yearLabel ? yearLabel.textContent : '';
    return `出典: 「日本の図書館 統計と名簿 ${yearText}年版」（日本図書館協会）、人口推計（e-Stat）を加工して作成`;
  }

  function getExportDetails() {
    if (chartMode === 'bar') {
      const metric = document.getElementById('barMetric').value;
      const year = document.getElementById('yearLabel').textContent;
      const highlight = document.getElementById('barUniSelect').value;
      const rankType = getBarRankType();
      const rankInfo = getBarRankInfo(rankType, Number(document.getElementById('yearSlider').value));
      return {
        title: `都道府県別 ${metric}`,
        conditions: [
          `表示形式: 棒グラフ`,
          `年度: ${year}年`,
          `表示内容: ${rankInfo.label}`,
          rankType === 'value' || !rankInfo.previousYear ? '' : `比較: ${year}年 - ${rankInfo.previousYear}年`,
          `表示範囲: ${getBarLimitLabel()}`,
          highlight ? `強調: ${highlight}` : '強調: なし'
        ].filter(Boolean),
        source: getSourceText()
      };
    }

    if (chartMode === 'scatter') {
      const year = document.getElementById('yearLabel').textContent;
      const highlight = document.getElementById('uniSelect').value;
      const xMax = document.getElementById('xMax').value;
      const yMax = document.getElementById('yMax').value;
      return {
        title: `${document.getElementById('ySelect').value} と ${document.getElementById('xSelect').value} の散布図`,
        conditions: [
          `表示形式: 散布図`,
          `年度: ${year}年`,
          `X軸: ${document.getElementById('xSelect').value}`,
          `Y軸: ${document.getElementById('ySelect').value}`,
          highlight ? `強調: ${highlight}` : '強調: なし',
          document.getElementById('showReg').checked ? '回帰直線: 表示' : '回帰直線: 非表示',
          document.getElementById('showMedian').checked ? '中央値ライン: 表示' : '中央値ライン: 非表示',
          xMax ? `X最大値: ${xMax}` : '',
          yMax ? `Y最大値: ${yMax}` : '',
          document.getElementById('corrDisplay').textContent
        ].filter(Boolean),
        source: getSourceText()
      };
    }

    if (chartMode === 'map') {
      const metric = document.getElementById('mapMetric').value;
      const year = document.getElementById('yearLabel').textContent;
      return {
        title: `都道府県別 ${metric}`,
        conditions: [
          `表示形式: 日本地図（${getMapStyleLabel(getMapStyle())}）`,
          `年度: ${year}年`,
          `項目: ${metric}`
        ],
        source: getSourceText()
      };
    }

    const selectedUniversities = getSelectedLineUniversities().map(formatLineUniversityLabel);
    return {
      title: `${document.getElementById('lineMetric').value}の推移`,
      conditions: [
        `表示形式: 折れ線グラフ`,
        `都道府県: ${selectedUniversities.join('、')}`,
        `項目: ${document.getElementById('lineMetric').value}`
      ],
      source: getSourceText()
    };
  }

  function saveChart(filename) {
    if (!chart) return;

    const exportCanvas = createExportCanvas(getExportDetails());
    downloadCanvas(exportCanvas, filename);
  }

  async function saveMap(filename) {
    try {
      const exportCanvas = await createMapExportCanvas(getExportDetails());
      downloadCanvas(exportCanvas, filename);
    } catch (error) {
      setShareStatus('PNG保存に失敗しました。時間をおいて再度お試しください。', true, 5000);
    }
  }

  function downloadCanvas(canvas, filename) {
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = sanitizeFileName(filename);
    link.click();
  }

  async function createMapExportCanvas(details) {
    const mapSvg = document.querySelector('#mapContainer .japan-map-svg');
    if (!mapSvg) throw new Error('Map SVG is not available.');

    const viewBox = mapSvg.getAttribute('viewBox').split(/\s+/).map(Number);
    const svgWidth = viewBox[2] || mapSvg.clientWidth || 700;
    const svgHeight = viewBox[3] || mapSvg.clientHeight || 700;
    const exportWidth = 1600;
    const margin = 56;
    const mapWidth = exportWidth - margin * 2;
    const mapHeight = Math.round(svgHeight * (mapWidth / svgWidth));
    const measureCanvas = document.createElement('canvas');
    const measureCtx = measureCanvas.getContext('2d');

    measureCtx.font = 'bold 30px sans-serif';
    const titleLines = wrapText(measureCtx, details.title, mapWidth);
    measureCtx.font = '18px sans-serif';
    const conditionLines = details.conditions.flatMap(line => wrapText(measureCtx, line, mapWidth));
    measureCtx.font = '16px sans-serif';
    const sourceLines = wrapText(measureCtx, details.source, mapWidth);

    const titleLineHeight = 38;
    const conditionLineHeight = 25;
    const sourceLineHeight = 23;
    const headerHeight = margin + titleLines.length * titleLineHeight + 12 + conditionLines.length * conditionLineHeight + 26;
    const footerHeight = 26 + sourceLines.length * sourceLineHeight + margin;
    const canvas = document.createElement('canvas');
    canvas.width = exportWidth;
    canvas.height = headerHeight + mapHeight + footerHeight;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    let y = margin;
    ctx.fillStyle = '#222222';
    ctx.font = 'bold 30px sans-serif';
    titleLines.forEach(line => {
      ctx.fillText(line, margin, y);
      y += titleLineHeight;
    });

    y += 12;
    ctx.fillStyle = '#444444';
    ctx.font = '18px sans-serif';
    conditionLines.forEach(line => {
      ctx.fillText(line, margin, y);
      y += conditionLineHeight;
    });

    y += 26;
    const image = await loadImageFromSvg(serializeMapSvg(mapSvg));
    ctx.drawImage(image, margin, y, mapWidth, mapHeight);

    y += mapHeight + 26;
    ctx.fillStyle = '#666666';
    ctx.font = '16px sans-serif';
    sourceLines.forEach(line => {
      ctx.fillText(line, margin, y);
      y += sourceLineHeight;
    });

    return canvas;
  }

  function serializeMapSvg(svg) {
    const clone = svg.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.removeAttribute('class');
    clone.querySelectorAll('.map-base-image').forEach(node => node.remove());
    clone.querySelectorAll('[tabindex]').forEach(node => node.removeAttribute('tabindex'));
    return new XMLSerializer().serializeToString(clone);
  }

  function loadImageFromSvg(svgText) {
    return new Promise((resolve, reject) => {
      const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const image = new Image();

      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Map SVG image failed to load.'));
      };
      image.src = url;
    });
  }

  function createExportCanvas(details) {
    const chartCanvas = chart.canvas;
    const exportWidth = 1600;
    const margin = 56;
    const chartWidth = exportWidth - margin * 2;
    const chartHeight = Math.round(chartCanvas.height * (chartWidth / chartCanvas.width));
    const measureCanvas = document.createElement('canvas');
    const measureCtx = measureCanvas.getContext('2d');

    measureCtx.font = 'bold 30px sans-serif';
    const titleLines = wrapText(measureCtx, details.title, chartWidth);
    measureCtx.font = '18px sans-serif';
    const conditionLines = details.conditions.flatMap(line => wrapText(measureCtx, line, chartWidth));
    measureCtx.font = '16px sans-serif';
    const sourceLines = wrapText(measureCtx, details.source, chartWidth);

    const titleLineHeight = 38;
    const conditionLineHeight = 25;
    const sourceLineHeight = 23;
    const headerHeight = margin + titleLines.length * titleLineHeight + 12 + conditionLines.length * conditionLineHeight + 26;
    const footerHeight = 26 + sourceLines.length * sourceLineHeight + margin;

    const canvas = document.createElement('canvas');
    canvas.width = exportWidth;
    canvas.height = headerHeight + chartHeight + footerHeight;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    let y = margin;
    ctx.fillStyle = '#222222';
    ctx.font = 'bold 30px sans-serif';
    titleLines.forEach(line => {
      ctx.fillText(line, margin, y);
      y += titleLineHeight;
    });

    y += 12;
    ctx.fillStyle = '#444444';
    ctx.font = '18px sans-serif';
    conditionLines.forEach(line => {
      ctx.fillText(line, margin, y);
      y += conditionLineHeight;
    });

    y += 26;
    drawChartWithoutEmbeddedText(ctx, margin, y, chartWidth, chartHeight);

    y += chartHeight + 26;
    ctx.fillStyle = '#666666';
    ctx.font = '16px sans-serif';
    sourceLines.forEach(line => {
      ctx.fillText(line, margin, y);
      y += sourceLineHeight;
    });

    return canvas;
  }

  function drawChartWithoutEmbeddedText(ctx, x, y, width, height) {
    const pluginOptions = chart.options?.plugins || {};
    const titleOptions = pluginOptions.title;
    const subtitleOptions = pluginOptions.subtitle;
    const previousTitleDisplay = titleOptions ? titleOptions.display : undefined;
    const previousSubtitleDisplay = subtitleOptions ? subtitleOptions.display : undefined;
    const previousSuppressEmbeddedChartText = suppressEmbeddedChartText;

    suppressEmbeddedChartText = true;
    if (titleOptions) titleOptions.display = false;
    if (subtitleOptions) subtitleOptions.display = false;
    chart.update('none');

    try {
      ctx.drawImage(chart.canvas, x, y, width, height);
    } finally {
      if (titleOptions) titleOptions.display = previousTitleDisplay;
      if (subtitleOptions) subtitleOptions.display = previousSubtitleDisplay;
      suppressEmbeddedChartText = previousSuppressEmbeddedChartText;
      chart.update('none');
    }
  }

  function wrapText(ctx, text, maxWidth) {
    const lines = [];
    let current = '';

    for (const character of String(text)) {
      const next = current + character;
      if (current && ctx.measureText(next).width > maxWidth) {
        lines.push(current);
        current = character;
      } else {
        current = next;
      }
    }

    if (current) lines.push(current);
    return lines;
  }

  function parsePositiveNumber(value) {
    if (value === '') return null;
    const numberValue = Number(value);
    return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : null;
  }

  function formatNumber(value) {
    return Number.isFinite(value) ? value.toLocaleString('ja-JP') : '';
  }

  function formatCompactValue(value) {
    if (!Number.isFinite(value)) return '';

    const absValue = Math.abs(value);
    if (absValue >= 100000000) return `${formatRoundedUnit(value / 100000000)}億`;
    if (absValue >= 10000) return `${formatRoundedUnit(value / 10000)}万`;
    if (absValue >= 1000) return `${formatRoundedUnit(value / 1000)}千`;
    return formatRoundedUnit(value);
  }

  function formatRoundedUnit(value) {
    const rounded = Math.round(value * 10) / 10;
    return rounded.toLocaleString('ja-JP', {
      maximumFractionDigits: Number.isInteger(rounded) ? 0 : 1
    });
  }

  function formatSignedNumber(value) {
    if (!Number.isFinite(value)) return '';
    const prefix = value > 0 ? '+' : '';
    return `${prefix}${formatNumber(Math.round(value * 10) / 10)}`;
  }

  function formatBarRankValue(value, rankType) {
    if (!Number.isFinite(value)) return '';
    if (rankType === 'rateUp' || rankType === 'rateDown') {
      return `${formatSignedNumber(Math.round(value * 10) / 10)}%`;
    }
    if (rankType === 'diffUp' || rankType === 'diffDown') {
      return formatSignedNumber(value);
    }
    return formatNumber(value);
  }

  function formatLineUniversityLabel(university) {
    return university === LINE_TOTAL_VALUE ? '合計（全都道府県）' : university;
  }

  function summarizeList(values, limit) {
    if (values.length <= limit) return values.join('、');
    return `${values.slice(0, limit).join('、')} ほか${values.length - limit}件`;
  }

  function toTransparentColor(hex, alpha) {
    const value = hex.replace('#', '');
    const r = parseInt(value.slice(0, 2), 16);
    const g = parseInt(value.slice(2, 4), 16);
    const b = parseInt(value.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function getChartPlugins() {
    const plugins = [quadrantPlugin, footerPlugin];
    if (window.ChartDataLabels) plugins.unshift(window.ChartDataLabels);
    return plugins;
  }

  function destroyChart() {
    if (chart) {
      chart.destroy();
      chart = null;
    }
  }

  function sanitizeFileName(filename) {
    return String(filename).replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_');
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[character]));
  }
})();
