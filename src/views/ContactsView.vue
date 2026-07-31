<script setup>
/**
 * ContactsView
 * ------------------------------------------------------------------
 * 联系人列表（tree 型：组 → 成员）。
 *
 * 数据来源：GET /jmate/seats/list —— 服务端返回扁平 list，前端按 role 分组：
 *   - 客服   (role === 'customer_service')
 *   - 管理员 (role === 'admin')
 *
 * 交互：选中成员 → emit('select', member) → MainView 构造 conversation 喂给 ChatMain
 */

import { ref, computed, onMounted, watch } from 'vue'
import { fetchContacts } from '../services/contact'
import userService from '../services/user'
import Avatar from '../components/Avatar.vue'

const emit = defineEmits(['select'])

const loading = ref(false)
const error = ref('')
const items = ref([])                 // 扁平数组（来自 /jmate/seats/list）
const collapsedGroups = ref(new Set()) // 已折叠的组 id
const keyword = ref('')               // 搜索关键词（服务端 ILIKE 匹配）

let searchTimer = null
function scheduleReload() {
  // 输入防抖 300ms，避免连续打字触发高频请求
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => load(), 300)
}

watch(keyword, () => scheduleReload())

// 角色映射（接口文档：role 是字符串）
const ROLE_GROUPS = [
  { key: 'customer_service', label: '客服' },
  { key: 'admin',            label: '管理员' }
]
// 接口可能返回未知 role（例如后续新增），单独兜底成一组
const ROLE_LABELS = Object.fromEntries(ROLE_GROUPS.map((r) => [r.key, r.label]))

async function load() {
  loading.value = true
  error.value = ''
  try {
    const list = await fetchContacts({ keyword: keyword.value })
    // 排除当前登录用户（接口字段是 user_id）
    const me = userService.getCurrentUser()?.id
    items.value = me ? list.filter((u) => u.user_id !== me) : list
  } catch (e) {
    console.warn('[ContactsView] load failed', e)
    error.value = '加载联系人失败'
  } finally {
    loading.value = false
  }
}

// 按 role 分组成 tree 形态
const groups = computed(() => {
  const all = items.value
  // 先把每个 role 拆出来
  const bucket = new Map()
  for (const r of ROLE_GROUPS) bucket.set(r.key, [])
  bucket.set('__other__', [])
  for (const u of all) {
    const k = bucket.has(u.role) ? u.role : '__other__'
    bucket.get(k).push(u)
  }
  // 按 ROLE_GROUPS 顺序输出；未识别 role 放最后
  const out = []
  for (const r of ROLE_GROUPS) {
    const members = bucket.get(r.key).slice().sort((a, b) => (a.nickname || '').localeCompare(b.nickname || ''))
    out.push({ id: r.key, nickname: r.label, members })
  }
  const others = bucket.get('__other__')
  if (others.length) {
    others.sort((a, b) => (a.nickname || '').localeCompare(b.nickname || ''))
    out.push({ id: '__other__', nickname: '其他', members: others })
  }
  return out.filter((g) => g.members.length > 0)
})

const totalCount = computed(() => items.value.length)

function toggleGroup(id) {
  // 注意：Set 没有响应式触发，需要替换
  const next = new Set(collapsedGroups.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  collapsedGroups.value = next
}

function isCollapsed(id) {
  return collapsedGroups.value.has(id)
}

function onPick(member) {
  emit('select', member)
}

onMounted(() => load())
</script>


<template>
  <main class="cv">
    <!-- 联系人列表 -->
    <section class="cv__list">
      <header class="cv__list-header">
        <div class="cv__search">
          <!-- 暂时不做关键词过滤，UI 框架先留着 -->
          <input
            v-model="keyword"
            class="cv__search-input"
            type="text"
            placeholder="搜索联系人(账号/昵称/邮箱)..."
          />
        </div>
        <span class="cv__count">共 {{ totalCount }} 人</span>
      </header>

      <div class="cv__scroll">
        <div v-if="loading" class="cv__placeholder">加载中...</div>
        <div v-else-if="error" class="cv__placeholder cv__placeholder--error">{{ error }}</div>
        <div v-else-if="!groups.length" class="cv__placeholder">暂无联系人</div>
        <ul v-else class="cv__tree">
          <li v-for="g in groups" :key="g.id" class="cv__group">
            <button class="cv__group-row" type="button" @click="toggleGroup(g.id)">
              <span class="cv__caret" :class="{ 'cv__caret--open': !isCollapsed(g.id) }">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
              </span>
              <span class="cv__group-name">{{ g.nickname }}</span>
              <span class="cv__group-count">{{ g.members.length }}</span>
            </button>
            <ul v-if="!isCollapsed(g.id)" class="cv__members">
              <li v-for="m in g.members" :key="m.id">
                <button class="cv__member" type="button" @click="onPick(m)">
                  <Avatar :name="m.nickname" :avatar="m.avatar" size="sm" />
                  <span class="cv__member-name">{{ m.nickname }}</span>
                </button>
              </li>
              <li v-if="!g.members.length" class="cv__empty-members">无成员</li>
            </ul>
          </li>
        </ul>
      </div>
    </section>
  </main>
</template>

<style scoped>
.cv {
  /* flex: 1; */
  display: flex;
  min-width: 0;
  height: 100%;
  background: var(--bg, #fff);
  overflow: hidden;
}

.cv__list {
  flex: 1 1 300px;
  width: 300px;
  max-width: 300px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border, #e2e8f0);
  overflow: hidden;
}

.cv__list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border, #e2e8f0);
  background: #fff;
  flex-shrink: 0;
  gap: 12px;
}

.cv__search {
  flex: 1;
  max-width: 420px;
}
.cv__search-input {
  width: 100%;
  padding: 6px 12px;
  border: 1px solid transparent;
  background: var(--bg-mute, #f1f5f9);
  border-radius: 8px;
  font-size: 13px;
  outline: none;
  color: var(--text-1, #0f172a);
}
.cv__search-input:focus {
  border-color: var(--primary, #0080ff);
  background: #fff;
}
.cv__count {
  font-size: 12px;
  color: var(--text-3, #475569);
  white-space: nowrap;
}

.cv__scroll {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}

.cv__placeholder {
  padding: 32px 16px;
  text-align: center;
  font-size: 13px;
  color: var(--text-3, #94a3b8);
}
.cv__placeholder--error {
  color: var(--error, #ef4444);
}

.cv__tree {
  list-style: none;
  margin: 0;
  padding: 0;
}

.cv__group {
  margin-bottom: 2px;
}

.cv__group-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 16px;
  border: 0;
  background: transparent;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-2, #475569);
  cursor: pointer;
  border-radius: 0;
  text-align: left;
  transition: background 0.15s;
}
.cv__group-row:hover {
  background: var(--bg-mute, #f1f5f9);
}

.cv__caret {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  color: var(--text-3, #94a3b8);
  transition: transform 0.15s;
  transform: rotate(0deg);
}
.cv__caret--open {
  transform: rotate(90deg);
}

.cv__group-name {
  flex: 1;
  text-transform: none;
  letter-spacing: 0;
}

.cv__group-count {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-3, #94a3b8);
  background: var(--bg-mute, #f1f5f9);
  padding: 1px 8px;
  border-radius: 999px;
  min-width: 22px;
  text-align: center;
}

.cv__members {
  list-style: none;
  margin: 0;
  padding: 0;
}

.cv__member {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px 8px 36px;
  border: 0;
  background: transparent;
  font: inherit;
  cursor: pointer;
  text-align: left;
  color: var(--text-1, #0f172a);
  transition: background 0.15s;
}
.cv__member:hover {
  background: var(--bg-mute, #f1f5f9);
}

.cv__member-name {
  font-size: 13px;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cv__empty-members {
  padding: 6px 16px 6px 36px;
  font-size: 12px;
  color: var(--text-3, #94a3b8);
  font-style: italic;
}
</style>
