/**
 * 头像背景计算工具
 *
 * 设计目标：同一个 userId 在任意端（Electron / Web / Node）算出来的色相一致。
 * 不用 Math.random()，避免刷新或跨端时颜色漂移。
 *
 * 算法：djb2 hash → 8 色固定调色板索引（决策 4.0.5b，参考样板 aichat-agent-console.html）。
 * 8 色按样板设计语言挑选：去掉黄绿等不和谐色相；
 * 色相均匀分布；饱和度/亮度统一，避免太鲜艳（眼睛疲劳）和太暗（与背景对比度低）。
 *
 * 8 色色相（HUE_PALETTE，HSL 度数）：与样板 .av / .msg .avatar / .ai-avatar
 * 橘红(15) / 玫红(345) / 紫(280) / 紫蓝(250) / 蓝(220) / 青蓝(195) / 粉(330) / 珊瑚(30)
 * —— 偏向样板 #FFB199 / #FF0844 / var(--ai) / #A78BFA 那一组暖+紫+蓝风格。
 */

/** 8 色固定色相盘（HSL 度数），顺序稳定保证 hash 一致 */
const HUE_PALETTE = [15, 30, 195, 220, 250, 280, 330, 345]

/**
 * djb2 hash → 0~7 调色板索引
 * @param {string|number|null|undefined} id
 * @returns {number} 0~7 的整数
 */
export function hashHue(id) {
  const s = String(id ?? '')
  if (s.length === 0) return 0
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    // (h * 33) ^ charCode  —— djb2 标准
    h = (h * 33) ^ s.charCodeAt(i)
  }
  // 转成无符号 32 位
  h = h >>> 0
  return h % HUE_PALETTE.length
}

/**
 * userId → 8 色调色板中某一色对的 linear-gradient 字符串
 * @param {string|number|null|undefined} id
 * @returns {string} 例如 'linear-gradient(135deg, hsl(220, 65%, 56%), hsl(220, 65%, 44%))'
 */
export function gradientFor(id) {
  const idx = hashHue(id)
  const h = HUE_PALETTE[idx]
  // 135deg 是参考样板 .av 的渐变方向；亮 → 暗
  return `linear-gradient(135deg, hsl(${h}, 65%, 56%), hsl(${h}, 65%, 44%))`
}

/**
 * userId → 单一纯色（用于测试或非渐变场景）
 * @param {string|number|null|undefined} id
 */
export function colorFor(id) {
  const idx = hashHue(id)
  const h = HUE_PALETTE[idx]
  return `hsl(${h}, 65%, 50%)`
}
