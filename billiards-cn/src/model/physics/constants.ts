// v1.3.65：台呢手感校准。
//
// 原来 mu=0.0055（无袋）/0.0066（有袋，见 tablegeometry.ts）对应的**等效滚动
// 阻力系数**只有 μr = mu/√2 ≈ 0.0047，而真实台呢的滚动阻力系数约 0.01 ——
// 只有真实值的一半，于是球的慢滚距离约为真实台呢的两倍：实测 1.5 m/s 的轻推
// 会滚 13 米（约 4.5 个台长）、耗时 24 秒，尾段蠕动明显不符合台呢物理。
//
// 滚动减速度 a = (1/√2)·mu·g（见 physics.ts rollingFull），故 mu 与滚动距离
// 成反比。目标 μr ≈ 0.0100 → mu = 0.0100 × √2 ≈ 0.0141（有袋）；无袋玩法
// 沿用原来的比例关系（0.0055 : 0.0066），取 0.0118。
export let mu = 0.0118 // Han rolling friction
export let muS = 0.126 // Han sliding friction
// 保持 0.045 不变：Mz ∝ mu·rho，mu 已翻倍，竖轴自旋衰减率随之由 4.52 提到
// 9.66 rad/s²（30 rad/s 的侧旋约 3.1 秒衰减完）—— 与「台呢阻力翻倍」物理自洽。
// 球停住后还要干等侧旋衰减完的问题，改由 ball.ts 的显式停球阈值解决。
export let rho = 0.045 // Han spindown rate

export let m = 0.23
export let R = 0.03275
export const g = 9.8

// Mathavan cushion coefficient of restitution
export let ee = 0.85

// Mathavan coefficient (table)
export let μs = 0.2

// Mathavan coefficient (cushion)
export let μw = 0.2

// Stronge slip stick ratio (cushion)
export let stronge_omega_ratio = 1.76

// Stronge restitution (cushion)
export let stronge_e_n = 0.77

// Stronge friction (cushion)
export let stronge_μ = 0.25

export let Mz: number
export let Mxy: number
export let I: number

export let e = 0.86 // Han cushion coefficient of restitution - unused
export let muC = 0.85 // Han cushion friction- unused

// Fixed angle of cushion contact point above ball center
export const sinθ = 2 / 5
// Fixed angle of cushion contact point above ball center
export const cosθ = Math.sqrt(21) / 5

export const offCenterLimit = 0.45
export const maxPower = 160 * R

refresh()

function refresh() {
  Mz = ((mu * m * g * 2) / 3) * rho
  Mxy = (7 / (5 * Math.sqrt(2))) * R * mu * m * g
  I = (2 / 5) * m * R * R
}

export function setR(val: number) {
  R = val
  refresh()
}
export function setm(val: number) {
  m = val
  refresh()
}
export function setmu(val: number) {
  if (val !== mu) {
    console.log(`[physics] mu changed: ${mu} -> ${val}`)
  }
  mu = val
  refresh()
}
export function setrho(val: number) {
  rho = val
  refresh()
}
export function setmuS(val: number) {
  muS = val
}
export function sete(val: number) {
  e = val
}
export function setmuC(val: number) {
  muC = val
}
export function setμs(val: number) {
  μs = val
}
export function setμw(val: number) {
  μw = val
}
export function setee(val: number) {
  ee = val
}

export function setstronge_omega_ratio(val: number) {
  stronge_omega_ratio = val
}
export function setstronge_e_n(val: number) {
  stronge_e_n = val
}
export function setstronge_μ(val: number) {
  stronge_μ = val
}
