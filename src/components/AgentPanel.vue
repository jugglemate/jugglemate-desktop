<script setup>
/**
 * AgentPanel — 客户侧栏（module-5）
 * ------------------------------------------------------------------
 * Props
 *   agents           : 从 MainView 传进来的 agent 列表（已由 AGENT_MYBOTS 加载）
 *   selectedAgentId  : 当前选中的 agent（写作用）
 *   mode             : 'collaborative' | 'managed'（agent 面板模式）
 *   hostedAgentId    : 当前会话被哪个 agent 托管
 *   customer         : 客户信息（来自 currentConversation 派生）；不传则用 mock
 * Emits
 *   select-agent     : 选中 agent（写）
 *   update:mode      : 切换协同/托管
 *   host-agent       : 托管当前 agent (auto_mode → 2)
 *   unhost-agent     : 取消当前托管 (auto_mode → 1)
 */
import { ref, computed } from 'vue'
import Avatar from './Avatar.vue'

const props = defineProps({
  agents: { type: Array, default: () => [] },
  selectedAgentId: { type: [String, Number], default: null },
  mode: { type: String, default: 'off' },
  hostedAgentId: { type: [String, Number], default: null },
  customer: { type: Object, default: null }
})

const emit = defineEmits([
  // 列表行点击：通知 chat 切换当前写作 agent（不改变 mode）
  'select-agent',
  // 列表行"托管"按钮：把会话托管给这个 agent（auto_mode 推到 2）
  'host-agent',
  // 列表行"取消托管"按钮：清掉当前会话的托管（auto_mode 回到 1）
  'unhost-agent',
])

// agents / customer 都由 MainView 通过 props 传入。
//   agents  来源：MainView loadAgents() → AGENT_MYBOTS
//   customer 来源：MainView currentCustomerInfo（从 currentConversation 派生）
// 数据未就绪时显示空态，不再在组件内做 mock 兜底（mock 已统一放到 MainView 侧）。
const agentList = computed(() => props.agents || [])
const customer = computed(() => props.customer || null)

// ---------------- Tabs（当前只实现 "agent 列表"，其余 tab 留空面板） ----------------
const tabs = [
  { key: 'agents', label: 'agent 列表' }
]
const activeTab = ref('agents')

console.log('AgentPanel.vue: agentList', agentList.value, 'customer', customer.value)


function onClickAgent(agent) {
  if (!agent) return
  emit('select-agent', agent.id)
}

function onHostClick(agent, e) {
  e.stopPropagation()
  emit('host-agent', agent.id)
}

function onUnhostClick(e) {
  e.stopPropagation()
  emit('unhost-agent')
}
</script>

<template>
  <aside class="customer-side">
    <!-- Tabs -->
    <div class="side-tabs">
      <div
        v-for="t in tabs"
        :key="t.key"
        class="side-tab"
        :class="{ active: activeTab === t.key }"
        @click="activeTab = t.key"
      >
        {{ t.label }}
      </div>
    </div>

    <!-- Body -->
    <div class="side-body">
      <div v-if="activeTab === 'agents'" class="agent-list">
        <div
          v-for="agent in agentList"
          :key="agent.id"
          class="agent-item"
          :class="{
            active:  agent.id === selectedAgentId,
            hosted:  agent.id === hostedAgentId,
            disabled: agent.enabled === false
          }"
          @click="onClickAgent(agent)"
        >
          <div class="agent-avatar">
            <Avatar
              :name="agent.name"
              :avatar="agent.emoji"
              size="md"
            />
          </div>
          <div class="agent-info">
            <div class="agent-name">{{ agent.name }}</div>
          </div>
          <button
            v-if="agent.id === hostedAgentId"
            type="button"
            class="agent-act agent-act--on"
            title="取消托管"
            @click="onUnhostClick($event)"
          >取消托管</button>
          <button
            v-else
            type="button"
            class="agent-act"
            :disabled="agent.enabled === false"
            :title="agent.enabled === false ? '该 agent 未启用' : '将当前会话托管给此 agent'"
            @click="onHostClick(agent, $event)"
          >托管</button>
        </div>

        <div v-if="agentList.length === 0" class="empty">暂无 Agent</div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
/* ============== 容器 ============== */
.customer-side {
  width: 300px;
  min-width: 300px;
  flex-shrink: 0;
  height: 100vh;
  background: var(--bg);
  border-radius: var(--r-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-sizing: border-box;
}

/* ============== 头部：客户 ============== */
.side-head {
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-soft);
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}
.side-head .avatar {
  position: relative;
  flex-shrink: 0;
}
.side-head .avatar .plat-dot {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid #fff;
}
.side-head .meta { flex: 1; min-width: 0; }
.side-head .name {
  font-size: 14px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-1);
  line-height: 1.2;
}
.side-head .name .unread-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--success);
  display: inline-block;
}
.side-head .sub {
  font-size: 11px;
  color: var(--text-2);
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
}
.side-head .more {
  width: 28px;
  height: 28px;
  color: var(--text-3);
  border: 0;
  background: transparent;
  border-radius: 6px;
  display: grid;
  place-items: center;
  cursor: pointer;
  transition: var(--t-fast);
}
.side-head .more:hover { background: var(--bg-mute); color: var(--text-1); }
.side-head .more svg { width: 16px; height: 16px; }

/* ============== Tabs ============== */
.side-tabs {
  display: flex;
  border-bottom: 1px solid var(--border);
  background: var(--bg);
  flex-shrink: 0;
  height: 56px;
}
.side-tab {
  padding: 11px 14px;
  font-size: 13px;
  color: var(--text-2);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: var(--t-fast);
  position: relative;
  user-select: none;
}
.side-tab:hover { color: var(--text-1); }
.side-tab.active {
  color: var(--primary);
  border-bottom-color: var(--primary);
  font-weight: 500;
}

/* ============== Body ============== */
.side-body {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}
.placeholder-pane {
  padding: 40px 16px;
  text-align: center;
  color: var(--text-3);
  font-size: 12px;
}

/* ============== Agent 列表 ============== */
.agent-list {
  display: flex;
  flex-direction: column;
  padding: 4px 0;
}
.agent-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  cursor: pointer;
  transition: var(--t-fast);
  background: var(--bg);
  border-bottom: 1px solid var(--border-soft);
}
.agent-item:hover {
  background: var(--bg-soft);
}
.agent-item.active {
  background: var(--primary-faint);
}
.agent-item.active::before {
  content: "";
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: var(--primary);
}
.agent-item.disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.agent-item.disabled .agent-act {
  cursor: not-allowed;
}

.agent-avatar {
  position: relative;
  flex-shrink: 0;
}
.agent-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.agent-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-1);
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.agent-item.active .agent-name {
  font-weight: 600;
}

/* 右侧托管按钮（行内小按钮） */
.agent-act {
  flex-shrink: 0;
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text-2);
  cursor: pointer;
  transition: var(--t-fast);
  font-family: inherit;
}
/* 取消托管按钮（已托管态）：静态 = 浅主色底 + 主色字 */
.agent-act--on {
  background: var(--primary-soft);
  border-color: var(--primary);
  color: var(--primary);
}
/* 取消托管按钮 hover：明确视觉反馈——底色加深 + 文字变白 + 红边。
   之前的实现是单纯把底色加深、文字变白，但 .agent-act:hover 的 color: var(--primary)
   会以更高优先级把字改回主色（一个 class 命中 vs 两个 class 命中，
   但顺序上 .agent-act:hover:not(:disabled) 写在前面导致 :hover 状态颜色反复），
   视觉上就像"文字和背景撞色"。这里改用直接覆盖 + 更强的边框/字色对比。 */
.agent-act--on:hover {
  background: var(--primary-hover);
  border-color: var(--primary-hover);
  color: #fff;
}
.agent-act--on:active {
  background: var(--primary-active);
  border-color: var(--primary-active);
}

/* 普通"托管"按钮（非 --on）：hover 时给浅主色底 + 主色字 + 主色边 */
.agent-act:not(.agent-act--on):hover:not(:disabled) {
  background: var(--primary-soft);
  border-color: var(--primary);
  color: var(--primary);
}
.agent-act:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.empty {
  padding: 40px 16px;
  text-align: center;
  color: var(--text-3);
  font-size: 12px;
}
</style>
