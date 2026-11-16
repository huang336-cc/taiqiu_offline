import type { Camera } from "./camera"

/**
 * v1.8.2：全桌机位手势 —— 单指旋转 + 捏合/滚轮缩放。
 *
 * 设计要点（都是被既有输入链逼出来的）：
 *
 * 1. **绑 `view.element` 而不是 `view.canvas`，用捕获阶段**。
 *    `renderer.domElement` 会在折叠屏尺寸恢复时惰性重建（utils/webgl.ts
 *    `ensureWebRenderer`），绑 canvas 会随重建失效；绑容器则一劳永逸。
 *    捕获阶段先于 `Drawing.onPointerDown`（点球对准）与
 *    `Keyboard.interact(...).draggable`（拖屏改瞄准）执行，可以整段吞掉事件。
 *    `pointermove` / `pointerup` 另绑在 window 捕获阶段，手指拖出容器也不丢手势。
 *
 * 2. **只对 canvas 上的指针生效**。HUD 按钮（相机/摆球/回放/力度条）也在
 *    `view.element` 内，若一律拦截，用户在全桌机位下就点不动按钮、切不走模式。
 *
 * 3. **门控 `cam.mode === cam.farView`**，其它机位一行不改、一个事件不拦。
 *
 * 4. **刷新 `lastEventTime`**：容器 60s 无事件就停 `view.render()`（rAF 仍跑），
 *    不刷新的话手势转两分钟后会「冻住」。
 *
 * 5. `setPointerCapture` 对合成/已释放指针会抛 NotFoundError，吞掉即可
 *    （沿用 controller/replay.ts 的做法）。
 */
export function setupFarGestures(
  element: HTMLElement,
  camera: Camera,
  getCanvas: () => HTMLCanvasElement | undefined,
  onActivity: () => void
) {
  const pointers = new Map<number, { x: number; y: number }>()
  let pinchDist = 0

  const isFar = () => camera.mode === camera.farView
  const onCanvas = (e: Event) => {
    const canvas = getCanvas()
    return !!canvas && e.target === canvas
  }

  const onPointerDown = (e: PointerEvent) => {
    if (!isFar() || !onCanvas(e)) return
    // 捕获阶段整段吞掉：点球对准 / 拖屏改瞄准 / 击球都不该在观察机位触发
    e.stopPropagation()
    e.preventDefault()
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()]
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y)
    }
    // 这里刻意**不调用 setPointerCapture**：实测在 element 捕获阶段调用会
    // 立刻派发 pointerout / pointerleave（target 从 canvas 变成 element），
    // 若绑了 pointerleave 就会把刚登记的指针删掉，后续 move 全部失效。
    // 改由 window 捕获阶段持续收 move/up，见下方绑定。
    onActivity()
  }

  const onPointerMove = (e: PointerEvent) => {
    const prev = pointers.get(e.pointerId)
    if (!prev || !isFar()) return
    e.stopPropagation()
    const dx = e.clientX - prev.x
    const dy = e.clientY - prev.y
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.size >= 2) {
      const [a, b] = [...pointers.values()]
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      if (pinchDist > 0 && d > 0) {
        camera.zoomFarBy(pinchDist / d)
      }
      pinchDist = d
    } else {
      camera.orbitFarBy(dx, dy)
    }
    onActivity()
  }

  const onPointerUp = (e: PointerEvent) => {
    if (!pointers.has(e.pointerId)) return
    pointers.delete(e.pointerId)
    if (pointers.size < 2) pinchDist = 0
  }

  const onWheel = (e: WheelEvent) => {
    if (!isFar() || !onCanvas(e)) return
    // 文档级 wheel（view/dom/aiminputs.ts:140）会改击球力度，必须挡在冒泡前
    e.preventDefault()
    e.stopPropagation()
    camera.zoomFarBy(e.deltaY > 0 ? 1.08 : 1 / 1.08)
    onActivity()
  }

  const opts: AddEventListenerOptions = { capture: true }
  element.addEventListener("pointerdown", onPointerDown, opts)
  // window 捕获阶段：拖出容器也不丢 move/up；非全桌机位或无活跃指针时直接 return
  globalThis.addEventListener("pointermove", onPointerMove, opts)
  globalThis.addEventListener("pointerup", onPointerUp, opts)
  globalThis.addEventListener("pointercancel", onPointerUp, opts)
  element.addEventListener("wheel", onWheel, { ...opts, passive: false })
}
