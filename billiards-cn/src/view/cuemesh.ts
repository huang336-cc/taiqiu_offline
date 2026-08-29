import { R } from "../model/physics/constants"
import { up } from "../utils/three-utils"
import { Settings, getCueTheme, getSkin, getTableSkin } from "../utils/settings"
import { getCueTexture, getCueButtTexture } from "./cuetexturefactory"

/** 对 0xRRGGBB 颜色做明暗调整（amount>0 提亮，<0 压暗），返回 0xRRGGBB */
function shade(hex: number, amount: number): number {
  const r = (hex >> 16) & 0xff
  const g = (hex >> 8) & 0xff
  const b = hex & 0xff
  const f = (c: number) =>
    Math.max(0, Math.min(255, Math.round(amount >= 0 ? c + (255 - c) * amount : c * (1 + amount))))
  return (f(r) << 16) | (f(g) << 8) | f(b)
}
import {
  Matrix4,
  Mesh,
  CylinderGeometry,
  MeshPhongMaterial,
  Vector3,
  ShaderMaterial,
  Group,
  PlaneGeometry,
  MeshBasicMaterial,
  ConeGeometry,
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
    fragmentShader: `
      varying vec2 vUv;
      varying vec3 vNormal;
      uniform vec3 lightDirection;
      void main() {
        float intensity = dot(vNormal, lightDirection);
        vec3 color = vec3(1.0, 1.0, 1.0);
        vec3 finalColor = color * intensity;
        gl_FragColor = vec4(finalColor, 0.075 * (1.0-vUv.y));
      }
    `,
    wireframe: false,
    transparent: true,
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
    mesh.renderOrder = -1
    mesh.material.depthTest = false
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
    const cueBody = this.cueGeometry(tip, but, length)
    const tiltGroup = new Group()
    const mesh = new Group()

    cueBody.applyMatrix4(
      new Matrix4().identity().makeRotationAxis(up, -Math.PI / 2)
    )
    cueBody.position.set(-length / 2 - R, 0, R * 0.12)
    tiltGroup.rotation.y = this.baseTilt
    tiltGroup.add(cueBody)
    mesh.add(tiltGroup)
    // 初始套用球杆主题（item 2）：auto 用皮肤色，具体主题套程序化贴图
    this.applyCueTheme(cueBody, Settings.get().cueTheme, Settings.get().skin)
    return { mesh, tiltMesh: tiltGroup, cueBody }
  }

  static cueGeometry(tipRadius, buttRadius, length, segments = 9) {
    const group = new Group()

    // Material Definitions - 根据皮肤选择颜色
    const skin = getSkin(Settings.get().skin)
    const ashWoodMat = new MeshPhongMaterial({ color: skin.shaftColor, shininess: 50 })
    const ebonyMat = new MeshPhongMaterial({ color: skin.buttColor, shininess: 80 })
    // 先角：浅米白色硬质材质（v1.3.51，原银白 0xe5e5e5）
    const ferruleMat = new MeshPhongMaterial({
      color: 0xf0e8d6,
      shininess: 100,
    })
    const tipMat = new MeshPhongMaterial({ color: skin.tipColor, shininess: 5 })

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
  static applyCueTheme(group: Group, themeId: string, _skinId: string) {
    const theme = getCueTheme(themeId)
    // v1.3.51：杆身与杆尾使用不同的分区贴图（握把/杆尾装饰/端盖）
    const shaftTex = getCueTexture(themeId)
    const buttTex = getCueButtTexture(themeId)
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
        // auto（随台面）：球杆颜色跟随「当前台球桌外观」的台呢色派生，
        // 使「单一外观设置」真正统一（台呢与球杆协调）。
        const ts = getTableSkin(Settings.get().tableSkin)
        const base = ts.clothColor
        const shaft = isButt ? shade(base, -0.28) : shade(base, 0.12)
        mat.map = null
        mat.color.setHex(shaft)
      }
      // 材质光泽：主题自带 finish 优先（哑光石砚 vs 玻璃/冰晶）；
      // 无 finish 且为 auto 时恢复几何默认，避免残留上一次主题的光泽。
      if (theme.finish) {
        mat.shininess = isButt ? theme.finish.butt : theme.finish.shaft
      } else if (!tex) {
        mat.shininess = isButt ? 80 : 50
      }
      mat.needsUpdate = true
    })
  }
}
