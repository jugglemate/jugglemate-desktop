<script setup>
// ContactsEmptyView
// 联系人面板的默认占位 —— 当用户进入「联系人」tab 但还没点选任何成员时显示。
// 独立组件，不复用 jm-empty —— jm-empty 是收件箱会话的空态，文案 / 装饰与本场景无关。
</script>

<template>
  <main class="ce">
    <div class="ce__inner">
      <div class="ce__art" aria-hidden="true">
        <!-- 三个圆形头像叠放 + 中间一个十字连接，传达「选择联系人」 -->
        <svg viewBox="0 0 140 110" fill="none" xmlns="http://www.w3.org/2000/svg">
          <!-- 左侧头像 -->
          <circle cx="34" cy="44" r="22" fill="#E0F0FF" stroke="#0080FF" stroke-width="1.5" />
          <circle cx="34" cy="38" r="6" fill="#0080FF" />
          <path d="M22 56c2-5 7-8 12-8s10 3 12 8" stroke="#0080FF" stroke-width="2" stroke-linecap="round" fill="none" />

          <!-- 右侧头像 -->
          <circle cx="106" cy="44" r="22" fill="#D6F5E6" stroke="#006C49" stroke-width="1.5" />
          <circle cx="106" cy="38" r="6" fill="#006C49" />
          <path d="M94 56c2-5 7-8 12-8s10 3 12 8" stroke="#006C49" stroke-width="2" stroke-linecap="round" fill="none" />

          <!-- 中间连接（双向箭头 + 小圆点） -->
          <line x1="58" y1="44" x2="82" y2="44" stroke="#94A3B8" stroke-width="1.5" stroke-dasharray="3 3" />
          <circle cx="70" cy="44" r="4" fill="#0080FF" />
          <circle cx="70" cy="44" r="1.5" fill="#FFFFFF" />
        </svg>
      </div>
      <h2 class="ce__title">选择一个联系人开始聊天</h2>
      <p class="ce__desc">从左侧联系人列表里挑一位同事，右侧会展开对应的会话窗口。</p>
      <!-- <ul class="ce__tips">
        <li><span class="dot"></span>按角色分组：<b>客服 / 管理员</b></li>
        <li><span class="dot"></span>分组行点击可折叠 / 展开</li>
        <li><span class="dot"></span>当前账号不会出现在列表中</li>
      </ul> -->
    </div>
  </main>
</template>

<style scoped>
.ce {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg, #fff);
  min-width: 0;
  height: 100%;
  padding: 24px;
}

.ce__inner {
  max-width: 380px;
  text-align: center;
}

.ce__art {
  width: 140px;
  height: 110px;
  margin: 0 auto 16px;
}

.ce__art svg {
  width: 100%;
  height: 100%;
  display: block;
}

.ce__title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-1, #0f172a);
  margin: 0 0 6px;
}

.ce__desc {
  font-size: 13px;
  color: var(--text-2, #475569);
  margin: 0 0 16px;
  line-height: 1.5;
}

/* .ce__tips {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  text-align: left;
  background: var(--bg-mute, #f8fafc);
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 10px;
  padding: 12px 16px;
}

.ce__tips li {
  font-size: 12px;
  color: var(--text-2, #475569);
  display: flex;
  align-items: center;
  gap: 8px;
}

.ce__tips b {
  color: var(--text-1, #0f172a);
  font-weight: 600;
}

.ce__tips .dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--primary, #0080ff);
  flex-shrink: 0;
} */
</style>
