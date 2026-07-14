<script setup>
/**
 * TicketTransferDialog
 * ------------------------------------------------------------------
 * 工单转移弹层（2026-07-14）。
 *
 * 数据源（v3：jugglemate-server 直接按 ticket_id 查 inbox 成员）：
 *   GET /jmate/tickets/inboxmembers/list?ticket_id=<ticketId>&limit=50[&start_id=<next_start_id>]
 *   ticket_id 约定等同于会话 id（不会为空）。
 *
 * UI 简化（v2）：
 *   - 列表项只展示 avatar + nickname（不展示角色 / 渠道 / 当前单数）
 *   - 不显示"全部 / 在线" tab（数据源没有这些维度，未来再加）
 *   - 过滤：member_type===1（机器人）+ 自己（user_id === currentUserId）
 *   - 自己从源头过滤掉，避免 disabled 视觉噪音
 *
 * 提交流程：
 *   确认 → POST /jmate/tickets/:id/transfer { to_assignee_id, note }
 *   → 父组件负责实际调用 ticketService.transfer()
 */

import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { fetchTransferCandidates } from '../services/agent'

const props = defineProps({
  show: { type: Boolean, default: false },
  // 当前工单的 ticket_id（不会为空，作为接口唯一入参；约定等同于会话 id）
  ticketId: { type: String, default: '' },
  // 当前显示用 short ID（如 #tk_001）
  ticketDisplayId: { type: String, default: '' },
  // 当前处理人显示文本（如 "我"）
  currentAssigneeName: { type: String, default: '我' }
})

const emit = defineEmits(['confirm', 'cancel'])

const keyword = ref('')
const selected = ref(null)  // 单选：{user_id, nickname, avatar}
const note = ref('')
const members = ref([])
const loading = ref(false)
const error = ref('')
let abortToken = 0  // 防止过期请求覆盖新数据

async function load() {
  if (!props.ticketId) {
    // ticket_id 不会为空 —— 如果走到这里说明 ChatMain 漏传，前端排查用。
    console.warn('[TicketTransferDialog] missing ticketId on open')
    return
  }
  const myToken = ++abortToken
  loading.value = true
  error.value = ''
  members.value = []
  try {
    const list = await fetchTransferCandidates(props.ticketId)
    if (myToken !== abortToken) return  // 过期请求丢弃
    members.value = list
  } catch (e) {
    if (myToken !== abortToken) return
    console.warn('[TicketTransferDialog] load members failed', { ticketId: props.ticketId, err: e })
    error.value = '加载成员失败，请稍后重试'
  } finally {
    if (myToken === abortToken) loading.value = false
  }
}

// 弹窗打开时拉一次
watch(() => props.show, (v) => {
  if (v) {
    keyword.value = ''
    selected.value = null
    note.value = ''
    load()
  }
})

onBeforeUnmount(() => { abortToken++ })

const filtered = computed(() => {
  const k = keyword.value.trim().toLowerCase()
  if (!k) return members.value
  return members.value.filter((m) => (m.nickname || '').toLowerCase().includes(k))
})

const noteLen = computed(() => note.value.length)
const NOTE_MAX = 100

function onPick(m) {
  if (selected.value?.user_id === m.user_id) {
    selected.value = null
  } else {
    selected.value = m
  }
}

function onConfirm() {
  if (!selected.value) return
  // payload: { user_id, nickname, note }
  // 服务端契约只用 user_id（→ MainView 会用 assignee_id 字段名转给后端）。
  // nickname / note 用于本地更新，不参与 HTTP body。
  emit('confirm', {
    user_id: selected.value.user_id,
    nickname: selected.value.nickname,
    note: note.value.trim()
  })
}

function onCancel() {
  emit('cancel')
}

function onBackdropClick(e) {
  if (e.target === e.currentTarget) onCancel()
}

function avatarBg(name) {
  // 与 Avatar.vue 一致：基于 name 字符码生成稳定的颜色 hash
  if (!name) return '#94A3B8'
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xfffffff
  const hue = h % 360
  return `hsl(${hue}, 55%, 50%)`
}
function initial(name) {
  const t = (name || '').trim()
  if (!t) return '?'
  return Array.from(t)[0].toUpperCase()
}
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="trf-overlay" @click="onBackdropClick">
      <div class="trf" role="dialog" aria-modal="true">

        <!-- Header -->
        <div class="trf__header">
          <div class="trf__title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round">
              <polyline points="15 17 20 12 15 7"></polyline>
              <path d="M4 18v-2a4 4 0 0 1 4-4h12"></path>
            </svg>
            转移工单
          </div>
          <button class="trf__close" aria-label="关闭" @click="onCancel">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        <!-- 上下文条 -->
        <div class="trf__ctx">
          <span>工单</span>
          <span class="trf__chip trf__chip--neutral">{{ ticketDisplayId || ticketId }}</span>
          <span class="trf__ctx-sep">·</span>
          <span style="color: var(--text-3);">当前处理人</span>
          <span class="trf__chip trf__chip--ghost">{{ currentAssigneeName }}</span>
          <template v-if="selected">
            <span class="trf__ctx-sep">→</span>
            <span class="trf__chip trf__chip--primary">{{ selected.nickname }}</span>
          </template>
        </div>

        <!-- 搜索框 -->
        <div class="trf__search">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"></circle>
            <path d="m21 21-4.3-4.3"></path>
          </svg>
          <input
            v-model="keyword"
            type="text"
            placeholder="搜索成员姓名"
            autocomplete="off"
          />
        </div>

        <!-- 列表 -->
        <div class="trf__list">

          <!-- loading -->
          <div v-if="loading" class="trf__empty">
            <div class="trf__empty-icon">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" stroke-width="1.5"
                   stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 12a9 9 0 1 1-6.219-8.56"></path>
              </svg>
            </div>
            <div class="trf__empty-title">加载成员中...</div>
          </div>

          <!-- error -->
          <div v-else-if="error" class="trf__empty">
            <div class="trf__empty-icon" style="color: var(--danger);">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" stroke-width="1.5"
                   stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
              </svg>
            </div>
            <div class="trf__empty-title">{{ error }}</div>
            <button class="trf__retry" @click="load">重新加载</button>
          </div>

          <!-- 空（无成员） -->
          <div v-else-if="members.length === 0" class="trf__empty">
            <div class="trf__empty-icon">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" stroke-width="1.5"
                   stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
              </svg>
            </div>
            <div class="trf__empty-title">没有可转移的目标</div>
            <div class="trf__empty-sub">群组内其他成员都已不在此会话</div>
          </div>

          <!-- 空（搜索无结果） -->
          <div v-else-if="filtered.length === 0" class="trf__empty">
            <div class="trf__empty-icon">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" stroke-width="1.5"
                   stroke-linecap="round" stroke-linejoin="round">
                <circle cx="11" cy="11" r="8"></circle>
                <path d="m21 21-4.3-4.3"></path>
                <line x1="8" y1="11" x2="14" y2="11"></line>
              </svg>
            </div>
            <div class="trf__empty-title">未找到匹配的成员</div>
            <div class="trf__empty-sub">尝试更换关键词</div>
          </div>

          <!-- 成员列表 -->
          <template v-else>
            <div
              v-for="m in filtered"
              :key="m.user_id"
              class="trf__member"
              :class="{ selected: selected?.user_id === m.user_id }"
              @click="onPick(m)"
            >
              <div class="avatar" :style="{ background: avatarBg(m.nickname) }">
                <template v-if="m.avatar">
                  <img :src="m.avatar" :alt="m.nickname" />
                </template>
                <template v-else>{{ initial(m.nickname) }}</template>
              </div>
              <div class="trf__member-info">
                <div class="trf__member-name">{{ m.nickname }}</div>
              </div>
              <svg
                v-if="selected?.user_id === m.user_id"
                width="16" height="16" viewBox="0 0 24 24" fill="none"
                stroke="var(--primary)" stroke-width="2.5"
                stroke-linecap="round" stroke-linejoin="round"
              >
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            </div>
          </template>
        </div>

        <!-- 备注 -->
        <div class="trf__note">
          <label class="trf__note-label">备注（可选，会作为系统消息通知对方）</label>
          <textarea
            v-model="note"
            rows="2"
            :maxlength="NOTE_MAX"
            placeholder="如：VIP 客户，麻烦优先处理"
          ></textarea>
          <div class="trf__note-counter" :class="{ over: noteLen >= NOTE_MAX }">
            {{ noteLen }} / {{ NOTE_MAX }}
          </div>
        </div>

        <!-- 操作栏 -->
        <div class="trf__footer">
          <div class="trf__footer-info">
            <span v-if="selected" style="color: var(--primary);">
              已选择 {{ selected.nickname }}
            </span>
            <span v-else>未选择目标</span>
          </div>
          <div class="trf__footer-actions">
            <button class="btn btn--outline" @click="onCancel">取消</button>
            <button
              class="btn btn--primary"
              :disabled="!selected"
              @click="onConfirm"
            >确认转移</button>
          </div>
        </div>

      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* 与项目 hubchat.css token 保持一致 */
.trf-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.3);
  z-index: 300;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: trfFadeIn 150ms ease-out;
}
.trf {
  background: var(--bg);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-lg);
  width: 100%;
  max-width: 420px;
  max-height: calc(100vh - 32px);
  display: flex;
  flex-direction: column;
  animation: trfSlideDown 200ms ease-out;
  overflow: hidden;
}
.trf__header {
  padding: 18px 20px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.trf__title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-1);
}
.trf__title svg { color: var(--primary); }
.trf__close {
  width: 28px; height: 28px;
  border: none; background: transparent;
  border-radius: var(--r-sm);
  cursor: pointer; color: var(--text-3);
  display: inline-flex; align-items: center; justify-content: center;
}
.trf__close:hover { background: var(--bg-mute); color: var(--text-1); }

.trf__ctx {
  padding: 0 20px 10px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-2);
}
.trf__chip {
  padding: 2px 8px;
  border-radius: var(--r-full);
  font-size: 11px;
  font-weight: 500;
}
.trf__chip--neutral { background: var(--primary-soft); color: var(--primary); }
.trf__chip--primary { background: var(--success-soft); color: var(--success); }
.trf__chip--ghost { background: var(--muted-soft); color: var(--text-2); }
.trf__ctx-sep { color: var(--text-4); }

.trf__search {
  padding: 0 20px 10px;
  position: relative;
}
.trf__search svg {
  position: absolute;
  left: 30px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-3);
  pointer-events: none;
}
.trf__search input {
  width: 100%;
  padding: 8px 10px 8px 32px;
  border: 1px solid var(--border);
  border-radius: var(--r);
  background: var(--bg-soft);
  font-size: 13px;
  color: var(--text-1);
  font-family: inherit;
  transition: all var(--t-fast);
}
.trf__search input:focus {
  outline: none;
  border-color: var(--primary);
  background: var(--bg);
  box-shadow: 0 0 0 3px rgba(0,128,255,.15);
}
.trf__search input::placeholder { color: var(--text-3); }

.trf__list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 12px;
  min-height: 180px;
  max-height: 280px;
}
.trf__list::-webkit-scrollbar { width: 6px; }
.trf__list::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 3px;
}

.trf__member {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: var(--r);
  cursor: pointer;
  transition: background var(--t-fast);
  position: relative;
}
.trf__member:hover { background: var(--bg-soft); }
.trf__member.selected {
  background: var(--primary-faint);
}
.trf__member.selected::before {
  content: "";
  position: absolute;
  left: 0; top: 6px; bottom: 6px;
  width: 3px;
  background: var(--primary);
  border-radius: 0 2px 2px 0;
}

.avatar {
  width: 32px;
  height: 32px;
  border-radius: var(--r-full);
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-weight: 600;
  font-size: 13px;
  overflow: hidden;
}
.avatar img { width: 100%; height: 100%; object-fit: cover; }

.trf__member-info { flex: 1; min-width: 0; }
.trf__member-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.trf__empty {
  padding: 40px 20px;
  text-align: center;
  color: var(--text-3);
}
.trf__empty-icon { margin-bottom: 8px; opacity: 0.6; }
.trf__empty-title {
  font-size: 13px;
  color: var(--text-2);
  margin-bottom: 4px;
}
.trf__empty-sub { font-size: 12px; }
.trf__retry {
  margin-top: 10px;
  padding: 4px 12px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text-2);
  border-radius: var(--r-sm);
  font-size: 12px;
  cursor: pointer;
}
.trf__retry:hover { background: var(--bg-soft); }

.trf__note {
  padding: 10px 20px;
  border-top: 1px solid var(--border-soft);
}
.trf__note-label {
  display: block;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-2);
  margin-bottom: 4px;
}
.trf__note textarea {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r);
  background: var(--bg-soft);
  font-size: 13px;
  color: var(--text-1);
  resize: none;
  font-family: inherit;
  transition: all var(--t-fast);
}
.trf__note textarea:focus {
  outline: none;
  border-color: var(--primary);
  background: var(--bg);
  box-shadow: 0 0 0 3px rgba(0,128,255,.15);
}
.trf__note-counter {
  text-align: right;
  font-size: 11px;
  color: var(--text-3);
  margin-top: 2px;
}
.trf__note-counter.over { color: var(--danger); }

.trf__footer {
  padding: 12px 20px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border-top: 1px solid var(--border-soft);
  background: var(--bg-soft);
}
.trf__footer-info {
  font-size: 12px;
  color: var(--text-3);
}

.btn {
  height: 32px;
  padding: 0 14px;
  border-radius: var(--r);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--t-fast);
  font-family: inherit;
  border: 1px solid transparent;
}
.btn--primary {
  background: var(--primary);
  color: #fff;
  border-color: var(--primary);
}
.btn--primary:hover:not(:disabled) { background: var(--primary-hover); }
.btn--primary:disabled {
  background: var(--bg-mute);
  color: var(--text-3);
  border-color: var(--border);
  cursor: not-allowed;
}
.btn--outline {
  background: transparent;
  color: var(--text-2);
  border-color: var(--border);
}
.btn--outline:hover { background: var(--bg-mute); }

@keyframes trfFadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes trfSlideDown {
  from { opacity: 0; transform: translateY(-12px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
</style>
