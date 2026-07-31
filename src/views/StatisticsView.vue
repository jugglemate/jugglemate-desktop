<script setup>
/**
 * StatisticsView
 * ------------------------------------------------------------------
 * 数据统计（仅管理员可见入口，由 NavSidebar.isAdmin 兜底）。
 *
 * 接口（详见 jugglemate-server/docs/console-stats-api.md）：
 *   - GET /jmate/console/stats/overview?from=&to=&granularity=
 *       → 4 张指标卡 totals + 趋势 new_sessions_trend + 渠道 channel_ranking
 *   - GET /jmate/console/stats/agents?from=&to=&include_admin=&page=&pageSize=
 *       → 坐席排行榜
 *
 * 占位字段（后端 pending=true）：transferred_to_human / csat_avg / frt_avg_ms
 *   UI 渲染为「数据采集中」徽章，避免把 0/null 当成真实数据。
 */

import { ref, reactive, computed, onMounted, watch } from 'vue'
import { SERVER_PATH, get } from '../services/api'

// ====================== 时间窗 ======================
// 'today' / '7d' / '30d' → 后端要求 YYYY-MM-DD（Asia/Shanghai）
const TIME_RANGES = [
  { key: 'today', label: '今日', days: 1 },
  { key: '7d',    label: '7天', days: 7 },
  { key: '30d',   label: '30天', days: 30 }
]
const activeTime = ref('7d')

function pad2(n) { return String(n).padStart(2, '0') }

function toYMD(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function rangeFor(key) {
  // 用本地日期算「今天 0 点」，再往前推 days-1 天得到 from
  // 后端按 Asia/Shanghai 解析，浏览器时区漂移 1 天会让 from 算错一天。
  // 这里用 Date + 时区偏移兜底：toFixedOffset('+08:00') 拿到上海零点。
  const tz = 'Asia/Shanghai'
  const today = new Date(new Date().toLocaleString('en-US', { timeZone: tz }))
  const range = TIME_RANGES.find((r) => r.key === key) || TIME_RANGES[1]
  const from = new Date(today)
  from.setDate(from.getDate() - (range.days - 1))
  return { from: toYMD(from), to: toYMD(today), granularity: 'day' }
}

// ====================== 4 张指标卡 ======================
// icon 用 inline SVG（不依赖 Material Symbols 字体，避免 web font 阻塞）
const ICON_FORUM   = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>'
const ICON_BOT     = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="12" rx="2"/><path d="M12 2v6"/><circle cx="9" cy="14" r="1"/><circle cx="15" cy="14" r="1"/><path d="M9 18h6"/></svg>'
const ICON_PLUS    = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="10" y1="11" x2="14" y2="11"/></svg>'
const ICON_HEADSET = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 14v-3a9 9 0 0 1 18 0v3"/><path d="M21 14h-3v5h3z"/><path d="M3 14h3v5H3z"/></svg>'

const metrics = ref([
  { key: 'sessions', label: '全部会话总数', icon: ICON_FORUM,   value: null, suffix: '',  tone: 'primary',   hint: '未关闭',          hintValue: null, pending: false },
  { key: 'ai',       label: 'AI 解决率',     icon: ICON_BOT,     value: null, suffix: '%', tone: 'secondary', hint: null,             progress: null, pending: false },
  { key: 'new',      label: '时间窗新增会话', icon: ICON_PLUS,   value: null, suffix: '',  tone: 'tertiary',  hint: 'AI 已解决',       hintValue: null, pending: false },
  { key: 'handoff',  label: '转人工会话',    icon: ICON_HEADSET, value: null, suffix: '',  tone: 'error',     hint: null,             progress: null, pending: false }
])

function formatMetric(m) {
  if (m.pending) return '—'
  if (m.value === null || m.value === undefined) return '—'
  if (m.suffix === '%') return `${Number(m.value).toFixed(1)}%`
  return Number(m.value).toLocaleString() + (m.suffix || '')
}

// ====================== 渠道排行 ======================
// channel_type 映射（接口文档当前支持 widget / juggleim / telegram）
const CHANNEL_META = {
  widget:    { name: 'Web',        color: '#0080FF' },
  juggleim:  { name: 'JuggleChat', color: '#006C49' },
  telegram:  { name: 'Telegram',   color: '#0088CC' },
  whatsapp:  { name: 'WhatsApp',   color: '#25D366' }
}
// 全量渠道槽位（顺序固定，与服务端返回顺序无关）
const FULL_CHANNELS = ['widget', 'juggleim', 'telegram', 'whatsapp']
const channelRanking = ref([])

// 趋势柱 hover 状态：{ bucket, total, ai_resolved, x }，null 表示不显示
const trendHover = ref(null)

// 把服务端返回的 channel_ranking 与全量渠道合并：
// 服务端有数据 → 用服务端的 count/percentage；无数据 → 强制 0/0 也渲染一行
const fullChannelRanking = computed(() => {
  const map = new Map()
  for (const r of channelRanking.value) map.set(r.channel_type, r)
  return FULL_CHANNELS.map((key) => {
    const r = map.get(key)
    return {
      channel_type: key,
      count: r?.count ?? 0,
      percentage: r?.percentage ?? 0
    }
  })
})

// ====================== 趋势图 ======================
const newSessionsTrend = ref([])
const trendSummary = computed(() => {
  const t = newSessionsTrend.value
  if (!t.length) return null
  let total = 0, aiTotal = 0, peak = { bucket: '', total: 0 }
  for (const b of t) {
    total += b.total
    aiTotal += b.ai_resolved
    if (b.total > peak.total) peak = b
  }
  return { total, aiTotal, peak, count: t.length }
})

// 柱状图高度百分比：AI 部分 + 总量
const trendMax = computed(() => {
  const t = newSessionsTrend.value
  if (!t.length) return 1
  return Math.max(...t.map((d) => d.total), 1)
})

function trendBarHeightPct(bucket, isAi) {
  const max = trendMax.value
  const v = isAi ? bucket.ai_resolved : bucket.total
  if (!max) return '0%'
  return `${(v / max) * 100}%`
}

// ====================== 坐席排行榜 ======================
const AGENT_PAGE_SIZE = 15
const leaderboard = ref([])
const agentPager = reactive({ page: 1, pageSize: AGENT_PAGE_SIZE, total: 0 })
const agentLoading = ref(false)

function agentInitials(nickname) {
  if (!nickname) return '?'
  // 中文取最后两个字，英文取首字母（最多 2 位）
  const cn = nickname.match(/[一-龥]/g)
  if (cn && cn.length) return cn.slice(-2).join('')
  return nickname.slice(0, 2).toUpperCase()
}

// 状态标记：根据 open_sessions 阈值映射（后端没给现成状态）
function agentStatus(openSessions) {
  if (openSessions === 0) return { label: '优秀', tone: 'success' }
  if (openSessions <= 5)  return { label: '达标', tone: 'primary' }
  return { label: '预警', tone: 'error' }
}

// ====================== 加载总览 ======================
const overviewLoading = ref(false)
const overviewError = ref('')

async function loadOverview() {
  overviewLoading.value = true
  overviewError.value = ''
  try {
    const r = rangeFor(activeTime.value)
    const res = await get(SERVER_PATH.STATS_OVERVIEW, r)
    if (res?.code === 0 && res.data) {
      const d = res.data
      const t = d.totals || {}
      metrics.value[0].value = t.total_sessions
      metrics.value[0].hint = '未关闭'
      metrics.value[0].hintValue = t.open_sessions != null ? Number(t.open_sessions).toLocaleString() : null
      metrics.value[1].value = t.ai_resolution_rate
      metrics.value[1].progress = t.ai_resolution_rate
      metrics.value[2].value = t.total_sessions
      metrics.value[2].hint = 'AI 已解决'
      metrics.value[2].hintValue = t.ai_resolved_sessions != null ? Number(t.ai_resolved_sessions).toLocaleString() : null
      metrics.value[3].value = t.transferred_to_human
      metrics.value[3].pending = !!t.transferred_to_human_pending
      metrics.value[3].hint = t.transferred_to_human_pending ? '数据采集中' : null
      metrics.value[3].progress = null
      channelRanking.value = Array.isArray(d.channel_ranking) ? d.channel_ranking : []
      newSessionsTrend.value = Array.isArray(d.new_sessions_trend) ? d.new_sessions_trend : []
    } else {
      overviewError.value = res?.msg || '加载失败'
    }
  } catch (e) {
    console.warn('[StatisticsView] load overview failed', e)
    overviewError.value = '网络错误，请稍后重试'
  } finally {
    overviewLoading.value = false
  }
}

// ====================== 加载坐席榜 ======================
async function loadAgents() {
  agentLoading.value = true
  try {
    const r = rangeFor(activeTime.value)
    const params = {
      ...r,
      include_admin: 'true',
      page: agentPager.page,
      pageSize: agentPager.pageSize
    }
    const res = await get(SERVER_PATH.STATS_AGENTS, params)
    if (res?.code === 0 && res.data) {
      const items = Array.isArray(res.data.items) ? res.data.items : []
      // 后端按 total_sessions DESC 排序；前端再用「全局排序」加 rank
      leaderboard.value = items.map((a, i) => ({
        rank: (agentPager.page - 1) * agentPager.pageSize + i + 1,
        userId: a.user_id,
        name: a.nickname || a.login_account || '-',
        initials: agentInitials(a.nickname || a.login_account),
        avatar: a.avatar || '',
        role: a.role,
        handled: a.total_sessions ?? 0,
        responded: a.responded_sessions ?? 0,
        open: a.open_sessions ?? 0,
        csat: a.csat_avg,
        csatPending: !!a.csat_pending,
        frtMs: a.frt_avg_ms,
        frtPending: !!a.frt_pending,
        status: agentStatus(a.open_sessions ?? 0)
      }))
      agentPager.total = Number(res.data.total || 0)
    }
  } catch (e) {
    console.warn('[StatisticsView] load agents failed', e)
  } finally {
    agentLoading.value = false
  }
}

const totalAgentPages = computed(() => Math.max(1, Math.ceil(agentPager.total / agentPager.pageSize)))

// 表格行统一形态：占位行（_kind=placeholder）或真实数据行
// 用一个 v-for 渲染，避免 v-if / v-else-if / v-for 平级触发 Vue 3 patch bug
const tableRows = computed(() => {
  if (leaderboard.value.length) return leaderboard.value.map((r) => ({ _key: `r-${r.userId}`, _kind: 'row', row: r }))
  const text = agentLoading.value ? '加载中...' : '暂无坐席数据'
  return [{ _key: 'placeholder', _kind: 'placeholder', text }]
})

function gotoAgentPage(p) {
  if (p < 1 || p > totalAgentPages.value || p === agentPager.page) return
  agentPager.page = p
  loadAgents()
}

// ====================== 工具 ======================
function fmtPercent(v) {
  if (v == null) return '—'
  return `${Number(v).toFixed(1)}%`
}

function fmtMs(ms) {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms}ms`
  const sec = ms / 1000
  if (sec < 60) return `${sec.toFixed(1)}s`
  return `${Math.floor(sec / 60)}m ${Math.floor(sec % 60)}s`
}

// 把 'YYYY-MM-DD' / 'YYYY-MM-DD HH' 拆成 { month, day, hour }
function parseBucket(b) {
  if (!b) return null
  const [d, h] = b.split(' ')
  const [y, m, day] = d.split('-')
  return { year: y, month: Number(m), day: Number(day), hour: h || '' }
}

// 轴上展示：只在跨月/首末显示月份，中间仅显示日期
function axisLabel(b, i, arr) {
  const cur = parseBucket(b)
  if (!cur) return ''
  if (i === 0) return `${pad2(cur.month)}-${pad2(cur.day)}`
  const prev = parseBucket(arr[i - 1]?.bucket)
  if (prev && prev.month !== cur.month) return `${pad2(cur.month)}-${pad2(cur.day)}`
  if (i === arr.length - 1) return `${pad2(cur.month)}-${pad2(cur.day)}`
  return `${cur.day}`
}

// ====================== 生命周期 ======================
function reloadAll() {
  agentPager.page = 1
  loadOverview()
  loadAgents()
}

watch(activeTime, () => reloadAll())
onMounted(() => reloadAll())
</script>

<template>
  <main class="sv">
    <header class="sv__header">
      <div>
        <h2 class="sv__title">综合数据分析</h2>
        <p class="sv__subtitle">统一监控服务渠道流量与坐席服务质量</p>
      </div>
      <div class="sv__time-filter" role="tablist">
        <button
          v-for="r in TIME_RANGES"
          :key="r.key"
          class="sv__time-btn"
          :class="{ 'sv__time-btn--active': activeTime === r.key }"
          @click="activeTime = r.key"
        >{{ r.label }}</button>
      </div>
    </header>

    <div v-if="overviewError" class="sv__error">{{ overviewError }}</div>

    <div class="sv__content">
      <!-- 4 张指标卡 -->
      <section class="sv__metrics">
        <div
          v-for="m in metrics"
          :key="m.key"
          class="sv__metric-card"
          :class="`sv__metric-card--${m.tone}`"
        >
          <div class="sv__metric-top">
            <div class="sv__metric-icon">
              <span class="sv__metric-svg" v-html="m.icon"></span>
            </div>
            <span v-if="m.pending" class="sv__pending-badge" title="后端尚未采集">数据采集中</span>
          </div>
          <p class="sv__metric-label">{{ m.label }}</p>
          <h3 class="sv__metric-value">{{ formatMetric(m) }}</h3>
          <div v-if="m.hint && !m.pending" class="sv__metric-hint">
            <span class="sv__metric-hint-label">{{ m.hint }}</span>
            <span class="sv__metric-hint-value">{{ m.hintValue === null ? '—' : m.hintValue }}</span>
          </div>
          <div v-else-if="m.progress !== null && !m.pending" class="sv__metric-bar">
            <div class="sv__metric-bar-fill" :style="{ width: `${m.progress}%` }"></div>
          </div>
        </div>
      </section>

      <!-- 工单趋势（纯 SVG 面积图） -->
      <section class="sv__trend">
        <div class="sv__section-head">
          <h4 class="sv__section-title">新增会话趋势</h4>
          <div v-if="trendSummary" class="sv__trend-summary">
            <span>合计 <b>{{ trendSummary.total.toLocaleString() }}</b></span>
            <span>AI 解决 <b>{{ trendSummary.aiTotal.toLocaleString() }}</b></span>
            <span>峰值 <b>{{ trendSummary.peak.bucket?.slice(5) }}</b> · {{ trendSummary.peak.total.toLocaleString() }}</span>
          </div>
        </div>
        <div v-if="!newSessionsTrend.length" class="sv__placeholder">暂无趋势数据</div>
        <div v-else class="sv__trend-chart" role="img" aria-label="新增会话趋势" :style="`--trend-cols: ${newSessionsTrend.length}`">
          <div class="sv__trend-grid" aria-hidden="true">
            <span v-for="i in 4" :key="i" class="sv__trend-grid-line"></span>
          </div>
          <div class="sv__trend-bars" @mouseleave="trendHover = null">
            <div
              v-for="(b, i) in newSessionsTrend"
              :key="b.bucket"
              class="sv__trend-bar"
              :class="{ 'sv__trend-bar--active': trendHover && trendHover.bucket === b.bucket }"
              @mouseenter="trendHover = b"
              @focus="trendHover = b"
              @blur="trendHover = null"
              tabindex="0"
              role="button"
              :aria-label="`${b.bucket} 总量 ${b.total} AI 解决 ${b.ai_resolved}`"
            >
              <div class="sv__trend-bar-ai" :style="{ height: trendBarHeightPct(b, true) }"></div>
              <div class="sv__trend-bar-total" :style="{ height: trendBarHeightPct(b, false) }"></div>
            </div>
          </div>
          <div class="sv__trend-axis">
            <span v-for="(b, i) in newSessionsTrend" :key="`ax-${b.bucket}`" class="sv__trend-tick">{{ axisLabel(b.bucket, i, newSessionsTrend) }}</span>
          </div>

          <!-- 自定义 tooltip：定位到 hover 柱子正上方 -->
          <div
            v-if="trendHover"
            class="sv__trend-tooltip"
            role="tooltip"
          >
            <div class="sv__trend-tooltip-date">{{ trendHover.bucket }}</div>
            <div class="sv__trend-tooltip-row">
              <span class="sv__trend-tooltip-dot sv__trend-tooltip-dot--total"></span>
              <span class="sv__trend-tooltip-label">新增会话</span>
              <span class="sv__trend-tooltip-value">{{ trendHover.total.toLocaleString() }}</span>
            </div>
            <div class="sv__trend-tooltip-row">
              <span class="sv__trend-tooltip-dot sv__trend-tooltip-dot--ai"></span>
              <span class="sv__trend-tooltip-label">AI 已解决</span>
              <span class="sv__trend-tooltip-value">{{ trendHover.ai_resolved.toLocaleString() }}</span>
            </div>
          </div>
        </div>
      </section>

      <!-- 渠道排行 -->
      <section class="sv__channels">
        <div class="sv__section-head">
          <h4 class="sv__section-title">各渠道访问量排行</h4>
        </div>
        <div v-if="!channelRanking.length" class="sv__placeholder">暂无渠道数据</div>
        <div v-else class="sv__channel-grid">
          <div v-for="c in fullChannelRanking" :key="c.channel_type" class="sv__channel">
            <div class="sv__channel-row">
              <span class="sv__channel-name">
                <span class="sv__channel-dot" :style="{ background: (CHANNEL_META[c.channel_type] || { color: '#94A3B8' }).color }"></span>
                {{ (CHANNEL_META[c.channel_type] || { name: c.channel_type }).name }}
              </span>
              <span class="sv__channel-stat">
                {{ c.count.toLocaleString() }}
                <span class="sv__channel-share">({{ Number(c.percentage).toFixed(1) }}%)</span>
              </span>
            </div>
            <div class="sv__channel-track">
              <div
                class="sv__channel-bar"
                :style="{ width: `${c.percentage}%`, background: (CHANNEL_META[c.channel_type] || { color: '#94A3B8' }).color }"
              ></div>
            </div>
          </div>
        </div>
      </section>

      <!-- 坐席排行榜 -->
      <section class="sv__leaderboard">
        <div class="sv__section-head sv__section-head--table">
          <h3 class="sv__section-title">坐席表现排行榜</h3>
          <span class="sv__table-meta">共 {{ agentPager.total }} 人 · {{ agentPager.pageSize }} 人/页</span>
        </div>
        <div class="sv__table-wrap">
          <table class="sv__table">
            <thead>
              <tr>
                <th>排名</th>
                <th>坐席信息</th>
                <th>回复会话量</th>
                <th>CSAT 满意度</th>
                <th>FRT 首响时间</th>
                <th>状态标记</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in tableRows" :key="item._key">
                <td v-if="item._kind === 'placeholder'" colspan="6" class="sv__placeholder">{{ item.text }}</td>
                <template v-else>
                  <td>
                    <span class="sv__rank" :class="{ 'sv__rank--top': item.row.rank === 1, 'sv__rank--warn': item.row.status.tone === 'error' }">{{ item.row.rank }}</span>
                  </td>
                  <td>
                    <div class="sv__agent">
                      <div class="sv__agent-avatar">{{ item.row.initials }}</div>
                      <div>
                        <p class="sv__agent-name">{{ item.row.name }}</p>
                        <p class="sv__agent-team">{{ item.row.role === 2 ? '管理员' : '客服' }} · 未关闭 {{ item.row.open }}</p>
                      </div>
                    </div>
                  </td>
                  <td class="sv__num">{{ item.row.handled.toLocaleString() }}</td>
                  <td>
                    <div v-if="item.row.csatPending" class="sv__pending-text">数据采集中</div>
                    <div v-else class="sv__csat">
                      <div class="sv__csat-bar">
                        <div
                          class="sv__csat-fill"
                          :class="{
                            'sv__csat-fill--success': item.row.csat >= 4.5,
                            'sv__csat-fill--primary': item.row.csat >= 4.0 && item.row.csat < 4.5,
                            'sv__csat-fill--error': item.row.csat < 4.0
                          }"
                          :style="{ width: `${(item.row.csat / 5) * 100}%` }"
                        ></div>
                      </div>
                      <span class="sv__csat-num" :class="{ 'sv__csat-num--error': item.row.csat < 4.0 }">{{ item.row.csat.toFixed(2) }}</span>
                    </div>
                  </td>
                  <td class="sv__num">
                    <span v-if="item.row.frtPending" class="sv__pending-text">数据采集中</span>
                    <span v-else>{{ fmtMs(item.row.frtMs) }}</span>
                  </td>
                  <td>
                    <span class="sv__pill" :class="`sv__pill--${item.row.status.tone}`">{{ item.row.status.label }}</span>
                  </td>
                </template>
              </tr>
            </tbody>
          </table>
        </div>
        <footer v-if="totalAgentPages > 1" class="sv__pager">
          <button class="sv__page-btn" :disabled="agentPager.page <= 1" @click="gotoAgentPage(agentPager.page - 1)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <span class="sv__pager-info">{{ agentPager.page }} / {{ totalAgentPages }}</span>
          <button class="sv__page-btn" :disabled="agentPager.page >= totalAgentPages" @click="gotoAgentPage(agentPager.page + 1)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </footer>
      </section>
    </div>
  </main>
</template>


<style scoped>
.sv {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  height: 100%;
  background: var(--bg, #fff);
  overflow-y: auto;
}

.sv__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 24px 16px;
  border-bottom: 1px solid var(--border, #e2e8f0);
  flex-shrink: 0;
}
.sv__title {
  font-size: 20px;
  font-weight: 600;
  color: var(--text-1, #0f172a);
  margin: 0;
}
.sv__subtitle {
  font-size: 13px;
  color: var(--text-2, #475569);
  margin: 4px 0 0;
}

.sv__time-filter {
  display: flex;
  background: var(--bg-mute, #f1f5f9);
  padding: 3px;
  border-radius: 8px;
  border: 1px solid var(--border, #e2e8f0);
}
.sv__time-btn {
  border: 0;
  background: transparent;
  font: inherit;
  cursor: pointer;
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-2, #475569);
  transition: all 0.15s;
}
.sv__time-btn:hover {
  color: var(--primary, #0080ff);
}
.sv__time-btn--active {
  background: #fff;
  color: var(--primary, #0080ff);
  box-shadow: 0 1px 2px rgba(9, 30, 66, 0.08);
}

.sv__content {
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

/* ====================== 指标卡 ====================== */
.sv__metrics {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}
.sv__metric-card {
  background: #fff;
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 12px;
  padding: 16px;
  box-shadow: 0 1px 2px rgba(9, 30, 66, 0.06);
  display: flex;
  flex-direction: column;
}
.sv__metric-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 12px;
}
.sv__metric-icon {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.sv__metric-svg {
  width: 20px;
  height: 20px;
  display: block;
}
.sv__metric-svg :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
}
.sv__metric-card--primary .sv__metric-icon { background: var(--primary-fixed, #e0f0ff); color: var(--primary, #0080ff); }
.sv__metric-card--secondary .sv__metric-icon { background: #d6f5e6; color: var(--secondary, #006c49); }
.sv__metric-card--tertiary .sv__metric-icon { background: #ffefd4; color: #b06a00; }
.sv__metric-card--error .sv__metric-icon { background: #ffe5e5; color: var(--error, #ef4444); }

.sv__metric-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-3, #94a3b8);
  margin: 0;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}
.sv__metric-value {
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.01em;
  margin: 6px 0 12px;
  color: var(--text-1, #0f172a);
}
.sv__metric-card--primary .sv__metric-value { color: var(--primary, #0080ff); }

.sv__metric-hint {
  margin-top: auto;
  padding-top: 12px;
  border-top: 1px solid var(--border, #e2e8f0);
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
}
.sv__metric-hint-label { color: var(--text-3, #94a3b8); }
.sv__metric-hint-value { font-weight: 700; color: var(--text-1, #0f172a); }

.sv__metric-bar {
  margin-top: auto;
  width: 100%;
  height: 6px;
  background: var(--bg-mute, #f1f5f9);
  border-radius: 999px;
  overflow: hidden;
}
.sv__metric-bar-fill {
  height: 100%;
  background: var(--secondary, #006c49);
  border-radius: 999px;
}

/* ====================== 渠道排行 ====================== */
.sv__channels {
  background: #fff;
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 12px;
  padding: 16px 20px 20px;
  box-shadow: 0 1px 2px rgba(9, 30, 66, 0.06);
}
.sv__section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}
.sv__section-head--table { margin-bottom: 0; padding: 16px 20px; border-bottom: 1px solid var(--border, #e2e8f0); }
.sv__section-title {
  font-size: 16px;
  font-weight: 600;
  margin: 0;
  color: var(--text-1, #0f172a);
}
.sv__btn-text {
  border: 0;
  background: transparent;
  color: var(--primary, #0080ff);
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  padding: 0;
}
.sv__btn-text:hover { text-decoration: underline; }

.sv__channel-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  column-gap: 48px;
  row-gap: 20px;
}
.sv__channel {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.sv__channel-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 14px;
}
.sv__channel-name {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-1, #0f172a);
}
.sv__channel-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.sv__channel-stat {
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  color: var(--text-1, #0f172a);
}
.sv__channel-share {
  color: var(--text-3, #94a3b8);
  margin-left: 4px;
}
.sv__channel-track {
  width: 100%;
  height: 16px;
  background: var(--bg-mute, #f1f5f9);
  border-radius: 4px;
  overflow: hidden;
}
.sv__channel-bar {
  height: 100%;
  border-radius: 4px;
  transition: width 1s;
}

/* ====================== 坐席排行榜 ====================== */
.sv__leaderboard {
  background: #fff;
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 1px 2px rgba(9, 30, 66, 0.06);
}
.sv__table-wrap { overflow-x: auto; }
.sv__table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
}
.sv__table th {
  padding: 14px 20px;
  font-size: 11px;
  font-weight: 700;
  color: var(--text-2, #475569);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  background: var(--bg-mute, #f1f5f9);
  border-bottom: 1px solid var(--border, #e2e8f0);
}
.sv__table td {
  padding: 14px 20px;
  border-bottom: 1px solid var(--border, #e2e8f0);
  font-size: 13px;
  color: var(--text-1, #0f172a);
  vertical-align: middle;
}
.sv__table tr:last-child td { border-bottom: 0; }
.sv__table tbody tr:hover { background: var(--bg-mute, #f1f5f9); }

.sv__rank {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--bg-mute, #f1f5f9);
  color: var(--text-2, #475569);
  font-weight: 800;
  font-size: 12px;
}
.sv__rank--1 { background: #ffefd4; color: #b06a00; }
.sv__rank--4 { background: var(--bg-mute, #f1f5f9); }

.sv__agent {
  display: flex;
  align-items: center;
  gap: 12px;
}
.sv__agent-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--primary-fixed, #e0f0ff);
  color: var(--primary, #0080ff);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 12px;
}
.sv__agent-name { margin: 0; font-weight: 600; }
.sv__agent-team { margin: 2px 0 0; font-size: 11px; color: var(--text-3, #94a3b8); }

.sv__num {
  font-variant-numeric: tabular-nums;
  font-weight: 500;
}
.sv__num--secondary { color: var(--secondary, #006c49); }
.sv__num--error { color: var(--error, #ef4444); }
.sv__num--muted { color: var(--text-3, #94a3b8); }

.sv__csat {
  display: flex;
  align-items: center;
  gap: 10px;
}
.sv__csat-bar {
  width: 96px;
  height: 6px;
  background: var(--bg-mute, #f1f5f9);
  border-radius: 999px;
  overflow: hidden;
}
.sv__csat-fill {
  height: 100%;
  border-radius: 999px;
}
.sv__csat-fill--success { background: var(--secondary, #006c49); }
.sv__csat-fill--primary { background: var(--primary, #0080ff); }
.sv__csat-fill--error { background: var(--error, #ef4444); }
.sv__csat-num { font-weight: 500; font-variant-numeric: tabular-nums; }
.sv__csat-num--error { color: var(--error, #ef4444); }

.sv__pill {
  display: inline-block;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
}
.sv__pill--success { background: #d6f5e6; color: var(--secondary, #006c49); }
.sv__pill--primary { background: var(--primary-fixed, #e0f0ff); color: var(--primary, #0080ff); }
.sv__pill--error { background: #ffe5e5; color: var(--error, #ef4444); }

@media (max-width: 1100px) {
  .sv__metrics { grid-template-columns: repeat(2, 1fr); }
  .sv__channel-grid { grid-template-columns: 1fr; }
}

/* ====================== 趋势图 ====================== */
.sv__trend {
  background: #fff;
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 12px;
  padding: 16px 20px 20px;
  box-shadow: 0 1px 2px rgba(9, 30, 66, 0.06);
}
.sv__trend-summary {
  display: flex;
  gap: 20px;
  font-size: 12px;
  color: var(--text-3, #475569);
}
.sv__trend-summary b {
  color: var(--text-1, #0f172a);
  font-weight: 700;
  margin: 0 2px;
}
.sv__trend-chart {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 180px;
  margin-top: 4px;
}
.sv__trend-grid {
  position: absolute;
  inset: 0 0 24px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  pointer-events: none;
}
.sv__trend-grid-line {
  height: 1px;
  background: #e2e8f0;
  border-top: 1px dashed #e2e8f0;
  background: transparent;
}
.sv__trend-bars {
  position: relative;
  flex: 1;
  display: grid;
  /* 列宽按数据数等分容器：列宽 = (容器宽 - gap×(n-1)) / n
   * 柱子 width: 30px + justify-self: center → 柱子居中于格子内，
   * 永远 ≤ 30px。轴 grid 用同一套列宽规则 → tick 中心 = 柱子中心。
   * CSS 变量 --trend-cols 在 script 里根据 newSessionsTrend.length 动态设置。 */
  grid-template-columns: repeat(var(--trend-cols, 7), 1fr);
  gap: clamp(4px, 1.5vw, 16px);
  align-items: end;
  padding: 0 8px;
  margin-bottom: 24px;
}
.sv__trend-bar {
  width: 30px;
  max-width: 30px;
  min-width: 6px;
  height: 100%;
  justify-self: center;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: stretch;
  position: relative;
  border-radius: 4px 4px 0 0;
  overflow: hidden;
  cursor: default;
}
.sv__trend-bar-total {
  background: #0080FF;
  transition: height 0.3s ease;
}
.sv__trend-bar-ai {
  background: #b6dcff;
  transition: height 0.3s ease;
}
.sv__trend-axis {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  display: grid;
  /* 列宽固定（不限制文字宽度）：列宽 = (容器宽 - gap×(n-1)) / n
   * 柱子在每格内 justify-self: center 居中 → 柱子中心和列中心对齐；
   * 轴 tick 不限宽，文字超出列会被相邻列推开（视觉上像普通分布）。
   * 用 auto-fit 让列数等于数据数，1fr 均分剩余空间。 */
  grid-template-columns: repeat(var(--trend-cols, 7), 1fr);
  gap: clamp(4px, 1.5vw, 16px);
  padding: 0 8px;
  font-size: 11px;
  color: var(--text-3, #94a3b8);
  height: 18px;
  align-items: center;
}
.sv__trend-tick {
  min-width: 0;
  text-align: center;
  white-space: nowrap;
}

.sv__trend-bar--active {
  outline: 2px solid rgba(0, 128, 255, 0.35);
  outline-offset: 0;
}
.sv__trend-bar:focus-visible {
  outline: 2px solid rgba(0, 128, 255, 0.55);
}
.sv__trend-tooltip {
  position: absolute;
  top: 8px;
  left: 50%;
  transform: translateX(-50%);
  background: #0F172A;
  color: #fff;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.5;
  pointer-events: none;
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.25);
  z-index: 10;
  min-width: 160px;
}
.sv__trend-tooltip::after {
  content: '';
  position: absolute;
  left: 50%;
  bottom: -4px;
  transform: translateX(-50%);
  border: 4px solid transparent;
  border-top-color: #0F172A;
}
.sv__trend-tooltip-date {
  font-weight: 700;
  font-size: 11px;
  color: #94A3B8;
  margin-bottom: 4px;
  letter-spacing: 0.02em;
}
.sv__trend-tooltip-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.sv__trend-tooltip-dot {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  display: inline-block;
}
.sv__trend-tooltip-dot--total { background: #0080FF; }
.sv__trend-tooltip-dot--ai    { background: #b6dcff; }
.sv__trend-tooltip-label {
  flex: 1;
  color: #CBD5E1;
}
.sv__trend-tooltip-value {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

/* ====================== 占位徽章 ====================== */
.sv__pending-badge {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 999px;
  background: #fef3c7;
  color: #92400e;
  letter-spacing: 0.02em;
}
.sv__pending-text {
  font-size: 11px;
  color: #92400e;
  background: #fef3c7;
  padding: 2px 8px;
  border-radius: 999px;
  display: inline-block;
}

/* ====================== 空态 / 错误 ====================== */
.sv__placeholder {
  padding: 32px 16px;
  text-align: center;
  font-size: 12px;
  color: var(--text-3, #94a3b8);
}
.sv__error {
  margin: 16px 24px 0;
  padding: 10px 16px;
  background: #fee2e2;
  border: 1px solid #fecaca;
  color: #991b1b;
  border-radius: 8px;
  font-size: 13px;
}

/* ====================== 表格元数据 + 分页 ====================== */
.sv__table-meta {
  font-size: 11px;
  color: var(--text-3, #94a3b8);
}
.sv__rank--top { background: #ffefd4; color: #b06a00; }
.sv__rank--warn { background: #fee2e2; color: #991b1b; }
.sv__pager {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 20px;
  border-top: 1px solid var(--border, #e2e8f0);
  background: var(--bg-mute, #f8fafc);
}
.sv__page-btn {
  width: 28px;
  height: 28px;
  border: 1px solid var(--border, #e2e8f0);
  background: #fff;
  border-radius: 6px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-2, #475569);
  transition: background 0.15s;
}
.sv__page-btn:hover:not(:disabled) {
  background: var(--bg-mute, #f1f5f9);
}
.sv__page-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.sv__pager-info {
  font-size: 12px;
  color: var(--text-2, #475569);
  min-width: 64px;
  text-align: center;
}

</style>
