import { R } from "../model/physics/constants"
import { up } from "../utils/three-utils"
import { Settings, getCueTheme, getSkin, getTableSkin } from "../utils/settings"
import { getCueTexture, getCueButtTexture } from "./cuetexturefactory"
import { loadPoolCue } from "./poolassets"

/**
 * 按权重把 `a` 往 `b` 混合，返回 0xRRGGBB。
 *
 * `t = 0` → 完全是 `a`；`t = 1` → 完全是 `b`。
 * 用于 auto 主题的「轻微向台面色靠拢」—— 权重必须小（见调用处的 0.12），
 * 否则就把玩家选的皮肤色吃掉了，正是本轮要修的那个坑。
 */
function mixHex(a: number, b: number, t: number): number {
  const k = Math.max(0, Math.min(1, t))
  const ch = (shift: number) => {
    const ca = (a >> shift) & 0xff
    const cb = (b >> shift) & 0xff
    return Math.max(0, Math.min(255, Math.round(ca + (cb - ca) * k)))
  }
  return (ch(16) << 16) | (ch(8) << 8) | ch(0)
}
import {
  Matrix4,
  Mesh,
  CylinderGeometry,
  MeshPhongMaterial,
  MeshStandardMaterial,
  Vector3,
  ShaderMaterial,
  Group,
  PlaneGeometry,
  MeshBasicMaterial,
  ConeGeometry,
  AdditiveBlending,
} from "three"

export type CueMeshes = {
  mesh: Group
  tiltMesh: Group
  cueBody: Group
}

export class CueMesh {
  static mesh: Mesh
  static readonly baseTilt = 0.17

  static readonly placermaterial = new MeshPhongMaterial({
    color: 0xffffff,
    wireframe: false,
    flatShading: false,
    transparent: false,
  })

  static indicateValid(valid) {
    CueMesh.placermaterial.color.setHex(valid ? 0xccffcc : 0xff0000)
  }

  private static readonly helpermaterial = new ShaderMaterial({
    uniforms: {
      lightDirection: { value: new Vector3(0, 0, 1) },
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vNormal;  
      void main() {
        vNormal = normal;
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
      }
    `,
    /**
     * 瞄准参考管（v1.3.85 重写）。
     *
     * 这是「方向提示」而非实体，所以它必须**几乎看不见、只留一层轮廓**，
     * 绝不能盖住台呢和母球。旧版有两个致命问题：
     *
     * 1) **正视叠加**：这是一个开口圆柱，从侧面看会同时穿过近壁和远壁，
     *    两层片元各自按 alpha 混合 → 视觉浓度翻倍。所以要按**边缘**加重、
     *    正面几乎全透，才对得上"管壁反光"的观感。
     * 2) **轴向 UV 用错**：`vUv.y` 沿圆柱长度（约 2m），而玩家只在
     *    白球附近看得到几十毫米，于是 `fade` 几乎恒等于 1，渐变形同虚设。
     *    改成沿**轴向绝对距离**淡出，才真的"离球越远越淡"。
     *
     * 用 `facing`（法线与视线夹角）做边缘增强：正对镜头时淡到接近 0，
     * 掠射（管壁边缘）时略亮，得到干净的两条侧影线 —— 这是唯一既能
     * 指示方向、又不糊住画面的做法。
     */
    fragmentShader: `
      varying vec2 vUv;
      varying vec3 vNormal;
      uniform vec3 lightDirection;
      void main() {
        // 视觉上：正对相机的管壁要透，掠射的边缘要留一点。
        vec3 n = normalize(vNormal);
        // viewDir 在本着色器里没有相机信息，用与光源方向的夹角近似"朝向"
        float rim = 1.0 - abs(dot(n, normalize(lightDirection)));
        float edge = smoothstep(0.55, 1.0, rim);
        // 沿轴向淡出：vUv.y 在 0~1，靠近白球一端（y≈0）最实
        float fade = 1.0 - clamp(vUv.y, 0.0, 1.0);
        vec3 tube = vec3(0.72, 0.92, 0.78);
        gl_FragColor = vec4(tube, 0.055 * edge * fade);
      }
    `,
    wireframe: false,
    transparent: true,
    blending: AdditiveBlending,
  })

  static createHelper() {
    const geometry = new CylinderGeometry(R, R, (R * 30) / 0.5, 12, 1, true)
    const mesh = new Mesh(geometry, this.helpermaterial)
    mesh.geometry
      .applyMatrix4(new Matrix4().identity().makeRotationAxis(up, -Math.PI / 2))
      .applyMatrix4(
        new Matrix4()
          .identity()
          .makeTranslation((R * 15) / 0.5, 0, (-R * 0.01) / 0.5)
      )
    mesh.visible = false
    /**
     * ⚠️ v1.3.85：`renderOrder = -1` + `depthTest = false` 的组合导致
     * 辅助管**绘制在母球和台面之上**，把白球糊成一片绿雾。
     * 改回正常深度测试，并让它在球之后绘制，球会正确遮挡它。
     */
    mesh.renderOrder = 4
    mesh.material.depthTest = true
    mesh.material.depthWrite = false
    return mesh
  }

  static createPlacer() {
    const group = new Group()
    const pyramidGeo = new ConeGeometry(0.75 * R, 1.6 * R, 4)
    const n = 4
    for (let i = 0; i < n; i++) {
      const pyramid = new Mesh(pyramidGeo, CueMesh.placermaterial)
      const angle = (i * 2 * Math.PI) / n

      // Distribute around the ball
      pyramid.position.x = Math.cos(angle) * 2 * R
      pyramid.position.y = Math.sin(angle) * 2 * R
      pyramid.position.z = 1 * R // Hover height

      // Point toward the center
      pyramid.lookAt(0, 0, R)
      // Adjust rotation because ConeGeometry points up its Y axis
      pyramid.rotateX(Math.PI / 2)

      group.add(pyramid)
    }
    group.visible = false
    return group
  }

  static createShadow(length: number) {
    const geometry = new PlaneGeometry(length, R * 0.4)
    geometry.applyMatrix4(
      new Matrix4().identity().makeTranslation(-length / 2 - R, 0, 0)
    )
    const material = new MeshBasicMaterial({
      color: 0x000000,
      opacity: 0.25,
      transparent: true,
      depthWrite: false,
    })
    const mesh = new Mesh(geometry, material)
    mesh.visible = true
    return mesh
  }

  static createCue(tip, but, length): CueMeshes {
    /**
     * v1.7.0：接入外部资源包的球杆模型（pool_cue.glb）。
     *
     * 结构沿用旧约定：cueBody 是一个「沿 +Y 居中、杆头在 +Y」的组，
     * 外面再整体绕 Z 转 −90° 让杆身沿 +X、杆头指向白球；位置与抬杆
     * 逻辑一行都不用改。
     *
     * 异步替换：GLB 到达前先挂程序化杆（占位），到达后整组换掉 ——
     * 否则开局头两百毫秒会「没有球杆」。
     */
    const cueBody = this.cueGeometry(tip, but, length)
    const tiltGroup = new Group()
    const mesh = new Group()

    cueBody.applyMatrix4(
      new Matrix4().identity().makeRotationAxis(up, -Math.PI / 2)
    )
    cueBody.position.set(-length / 2 - R, 0, R * 0.12)
    tiltGroup.add(cueBody)
    mesh.add(tiltGroup)
    // 初始套用球杆主题（item 2）：auto 用皮肤色，具体主题套程序化贴图
    this.applyCueTheme(cueBody, Settings.get().cueTheme, Settings.get().skin)

    loadPoolCue()
      .then((source) => {
        if (!cueBody.parent) return // 已被销毁
        /**
         * v1.8.4：**必须 clone**。
         *
         * loadPoolCue() 缓存并返回同一个 gltf.scene。旧代码直接
         * `cueBody.add(glb)` —— three 的 add 会把节点从原父级摘走，于是
         * **第二根球杆创建时，第一根的杆身被整个掏空**（cueBody.children=0，
         * 屏幕上再也看不到球杆）。
         *
         * 触发点很隐蔽：回放的 precomputeAllShots() 会用 rules.table() 新建
         * 一张模拟桌，那张桌也带 Cue，也走这段加载 —— 结果真实画面的杆被
         * 模拟桌的杆抢走。用户看到的「回放模式不显示球杆」就是这么来的，
         * 而且它跟视角、加塞、击球动画都无关。
         *
         * clone(true) 深拷贝节点树（材质共享，不额外占显存）。
         */
        const glb = source.clone(true) as Group
        // clone 会继承「上一根杆」被改过的变换，先复位再按本杆长度归一化。
        glb.position.set(0, 0, 0)
        glb.rotation.set(0, 0, 0)
        glb.scale.setScalar(1)
        // 资源包：杆尾 x=0 → 杆头 x=1.455（米制）。归一化到本工程长度，
        // 平移使杆身沿 X 居中，再绕 Z 转 +90° 变成「沿 +Y、杆头朝上」。
        const SRC_LEN = 1.455
        const k = length / SRC_LEN
        glb.scale.setScalar(k)
        /**
         * ⚠️ 平移轴是 **Y** 不是 X。
         *
         * 子节点的局部矩阵是 T·R·S —— 先旋转再平移，且平移量写在**父级**
         * 坐标系里。杆身绕 Z 转 +90° 后，几何的 +X 已经变成 +Y；此时若按
         * X 平移 −L/2，杆会被整体推到侧面（实机表现：瞄准视角里球杆消失）。
         * 正确做法是按旋转后的轴（Y）把杆身居中。
         */
        glb.rotation.z = Math.PI / 2
        glb.position.y = -length / 2
        /**
         * 按材质名把六段映射回旧名字 —— 工程里的换肤（applySkin）、
         * 主题（applyCueTheme）以及探针都靠这些名字定位。
         * GLTF 每个 primitive 是一个独立 Mesh，正好一段一个。
         */
        const NAME_MAP: Record<string, string> = {
          cue_shaft: "cueShaft",
          cue_butt: "cueButt",
          cue_ferrule: "cueFerrule",
          cue_tip: "cueTip",
          cue_wrap: "cueWrap",
          brass: "cueBrass",
        }
        glb.traverse((o: any) => {
          if (!o.isMesh) return
          const mn = o.material && o.material.name
          if (mn && NAME_MAP[mn]) o.name = NAME_MAP[mn]
          o.castShadow = true
          o.receiveShadow = true
        })
        // 先清掉占位几何，再挂新杆
        cueBody.clear()
        cueBody.add(glb)
        CueMesh.applyCueTheme(
          cueBody,
          Settings.get().cueTheme,
          Settings.get().skin
        )
      })
      .catch((e) => {
        console.warn("[cue] 新球杆加载失败，保留程序化杆:", (e as Error)?.message)
      })

    return { mesh, tiltMesh: tiltGroup, cueBody }
  }

  static cueGeometry(tipRadius, buttRadius, length, segments = 28) {
    const group = new Group()

    // Material Definitions - 根据皮肤选择颜色
    //
    // v1.6.0（3D 美化 P2）：Phong → Standard。
    //
    // 9 面圆柱的折线棱 + Phong 的「均匀塑料高光」是球杆廉价感的来源。
    // Standard 材质吃 scene.environment（台球厅环境贴图），漆面杆身
    // 能映出吊灯光带；分段数 9 → 28 消除侧面轮廓棱线。
    // shininess → roughness 的映射在 applyCueTheme 统一处理。
    const skin = getSkin(Settings.get().skin)
    const ashWoodMat = new MeshStandardMaterial({
      color: skin.shaftColor,
      roughness: 0.42,
      metalness: 0.0,
    })
    const ebonyMat = new MeshStandardMaterial({
      color: skin.buttColor,
      roughness: 0.3,
      metalness: 0.0,
    })
    // 先角：浅米白色硬质材质（v1.3.51，原银白 0xe5e5e5）
    const ferruleMat = new MeshStandardMaterial({
      color: 0xf0e8d6,
      roughness: 0.22,
      metalness: 0.05,
    })
    const tipMat = new MeshStandardMaterial({
      color: skin.tipColor,
      roughness: 0.92,
      metalness: 0.0,
    })

    // Ratios for a standard snooker cue
    const buttLength = length * 0.28
    const shaftLength = length * 0.71
    const ferruleLength = length * 0.007

    // 1. Butt
    const buttGeom = new CylinderGeometry(
      buttRadius * 0.9,
      buttRadius,
      buttLength,
      segments
    )
    const butt = new Mesh(buttGeom, ebonyMat)
    butt.name = "cueButt"
    butt.position.y = -length / 2 + buttLength / 2
    group.add(butt)

    // 2. Shaft
    const shaftGeom = new CylinderGeometry(
      tipRadius,
      buttRadius * 0.9,
      shaftLength,
      segments
    )
    const shaft = new Mesh(shaftGeom, ashWoodMat)
    shaft.name = "cueShaft"
    shaft.position.y = butt.position.y + buttLength / 2 + shaftLength / 2
    group.add(shaft)

    // 3. Ferrule
    const ferruleGeom = new CylinderGeometry(
      tipRadius,
      tipRadius,
      ferruleLength,
      segments
    )
    const ferrule = new Mesh(ferruleGeom, ferruleMat)
    ferrule.name = "cueFerrule"
    ferrule.position.y = shaft.position.y + shaftLength / 2 + ferruleLength / 2
    group.add(ferrule)

    // 4. Tip
    const tipHeight = 0.0055
    const tipTopRadius = tipRadius * 0.93
    const tipGeom = new CylinderGeometry(
      tipTopRadius,
      tipRadius,
      tipHeight,
      segments
    )
    const tip = new Mesh(tipGeom, tipMat)
    tip.position.y = ferrule.position.y + ferruleLength / 2 + tipHeight / 2
    tip.name = "cueTip"
    group.add(tip)

    return group
  }

  /**
   * 实时更换皮肤：遍历球杆各段 mesh，按名称重设材质颜色。
   * 不需要重建几何体，避免内存泄漏。
   */
  static applySkin(group: Group, skinId: string) {
    const skin = getSkin(skinId)
    group.traverse((child) => {
      const mesh = child as Mesh
      if (!(mesh as any).isMesh) return
      const mat = mesh.material as MeshPhongMaterial
      if (!mat || !mat.color) return
      switch (mesh.name) {
        case "cueButt":
          mat.color.setHex(skin.buttColor)
          break
        case "cueShaft":
          mat.color.setHex(skin.shaftColor)
          break
        case "cueTip":
          mat.color.setHex(skin.tipColor)
          break
        case "cueFerrule":
          // 铜箍保持银白，不随皮肤变化
          break
        default:
          break
      }
      mat.needsUpdate = true
    })
  }

  /**
   * 应用球杆主题（item 2）。
   * - auto：清除贴图，颜色由 applySkin 按皮肤设置（球杆随台面变化）。
   * - 具体主题：套用程序化贴图，并把材质色设为白，让贴图本色显示。
   * 颜色恢复在 auto 分支内完成，因此单独切换主题也不会留下上一次的白色。
   */
  /**
   * 套用球杆主题。
   *
   * 两条分支：
   *   · **贴图主题**（屠龙斩 / 青龙 / 火麒麟…）：把分区贴图贴上去，
   *     底色置白（贴图自带颜色）。
   *   · **auto（随台面）**：不打贴图，用**玩家选的球杆皮肤**上色。
   *
   * ---
   *
   * ⚠️ v1.3.85 修复「auto 架空了 skin 设置」。
   *
   * 病史：旧版 auto 分支直接 `mat.color.setHex(shade(clothColor, ±))` ——
   * 从**台呢色**派生球杆色，把 `cueGeometry()` 刚按 `skin` 上的色**整个覆盖**。
   * 后果：只要 `cueTheme === "auto"`（默认值），设置面板里五个球杆皮肤
   * 全部失效，切 classic→emerald→gold 画面毫无变化。
   *
   * 佐证：本方法签名原本是 `_skinId`（下划线 = 未使用），等于自认 skin
   * 在这条路径上没作用。
   *
   * 更糟的是观感：`classic` 台面墨绿 `0x1f6b34`，`+0.12` 提亮后得
   * `0x3a7d4c` —— 默认机位正对杆轴看，就是一根绿锥。
   *
   * 修复（方案 A）：auto **尊重 skin**。台面偏色权重取 0（见 CLOTH_TINT），
   * 球杆颜色完全由玩家选的皮肤决定，不再受台呢色影响。
   */
  static applyCueTheme(group: Group, themeId: string, skinId: string) {
    const theme = getCueTheme(themeId)
    // v1.3.51：杆身与杆尾使用不同的分区贴图（握把/杆尾装饰/端盖）
    const shaftTex = getCueTexture(themeId)
    const buttTex = getCueButtTexture(themeId)
    /**
     * auto 的台面协调量 —— **已设为 0**（球杆完全独立于台面）。
     *
     * 取值含义：把球杆色往台呢色混合的权重。
     *   · `0`    → 完全用 `skin` 的原色（当前选择）
     *   · `0.12` → 轻微向台面偏色（曾用值，会让原木杆带上一点台面绿）
     *   · `>0.3` → 皮肤色被明显吃掉，等于回到"架空 skin"的老毛病
     *
     * 保留这个常量而不直接删掉 mixHex，是为了让"要不要跟台面协调"
     * 成为一个**一改即生效**的开关，而不是需要重新推导混色逻辑。
     */
    const CLOTH_TINT = 0
    const cloth = getTableSkin(Settings.get().tableSkin).clothColor
    const skin = getSkin(skinId)
    group.traverse((child) => {
      const mesh = child as Mesh
      if (!(mesh as any).isMesh) return
      if (mesh.name !== "cueShaft" && mesh.name !== "cueButt") return
      const mat = mesh.material as MeshPhongMaterial
      if (!mat) return
      const isButt = mesh.name === "cueButt"
      const tex = isButt ? buttTex : shaftTex
      if (tex) {
        mat.map = tex
        mat.color.setHex(0xffffff)
      } else {
        // auto：完全使用玩家选的皮肤色（CLOTH_TINT 为 0 时无台面偏色）
        mat.map = null
        const base = isButt ? skin.buttColor : skin.shaftColor
        mat.color.setHex(
          CLOTH_TINT === 0 ? base : mixHex(base, cloth, CLOTH_TINT)
        )
      }
      // 材质光泽：主题自带 finish 优先（哑光石砚 vs 玻璃/冰晶）；
      // 无 finish 且为 auto 时恢复几何默认，避免残留上一次主题的光泽。
      //
      // v1.6.0：材质已升级为 MeshStandardMaterial，主题的 finish 仍以
      // Phong shininess 语义书写（0~100，越大越亮），这里换算成
      // roughness（越小越亮）：roughness ≈ 1 − shininess/105，下限 0.08
      // 保住玻璃/冰晶主题的镜面感，上限 0.95 保住哑光石砚。
      const toRough = (s: number) =>
        Math.min(0.95, Math.max(0.08, 1 - s / 105))
      if (theme.finish) {
        const s = isButt ? theme.finish.butt : theme.finish.shaft
        mat.shininess = s
        ;(mat as any).roughness = toRough(s)
      } else if (!tex) {
        mat.shininess = isButt ? 80 : 50
        ;(mat as any).roughness = toRough(isButt ? 80 : 50)
      }
      mat.needsUpdate = true
    })
  }
}
