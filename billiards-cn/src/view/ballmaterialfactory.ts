import {
  Color,
  MeshPhongMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
} from "three"
import { R } from "../model/physics/constants"
import { BallTextureFactory } from "./balltexturefactory"
import { BallCubeTextureFactory } from "./ballcubetexturefactory"
import { Session } from "../network/client/session"

export class BallMaterialFactory {
  private static readonly materialCache: Map<
    string,
    MeshStandardMaterial | MeshPhongMaterial | MeshPhysicalMaterial
  > = new Map()

  static createTexturedDotsMaterial(color: Color): MeshPhysicalMaterial {
    const key = `texturedDots_${color.getHex()}`
    if (this.materialCache.has(key)) {
      return this.materialCache.get(key) as MeshPhysicalMaterial
    }

    const cubeTexture = BallCubeTextureFactory.getOrCreateTexture(color)
    const material = new MeshPhysicalMaterial({
      color: color,
      roughness: 0.1,
      metalness: 0,
      clearcoat: 1.0,
      clearcoatRoughness: 0.02,
      reflectivity: 0.25,
    })

    material.onBeforeCompile = (shader: any) => {
      shader.uniforms.uCubeMap = { value: cubeTexture }

      shader.vertexShader = `
        varying vec3 vLocalPos;
        ${shader.vertexShader}
      `.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vLocalPos = position;`
      )

      shader.fragmentShader = `
        uniform samplerCube uCubeMap;
        varying vec3 vLocalPos;
        ${shader.fragmentShader}
      `.replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        // GLSL ES 3.00（WebGL2）中 textureCube 已废弃，使用 texture(samplerCube, vec3)
        diffuseColor.rgb = texture(uCubeMap, normalize(vLocalPos)).rgb;`
      )
    }

    this.materialCache.set(key, material)
    return material
  }

  static createDottedMaterial(color: Color): MeshPhongMaterial {
    const key = `dotted_${color.getHex()}`
    if (this.materialCache.has(key)) {
      return this.materialCache.get(key) as MeshPhongMaterial
    }

    const material = new MeshPhongMaterial({
      emissive: 0,
      // v1.3.93：关掉 flatShading。
      //
      // 这个材质给「画点」外观的球用，**母球就走这里**（ballmesh 里
      // isCueBall 分支）。开着面法线着色时，母球这颗纯白球在台面灯光下
      // 会把每个三角面照得明暗分明，一圈棱线非常扎眼——用户说的「球的
      // 锯齿也多」，母球是最显眼的一处。改为平滑法线后恢复成连续球面。
      flatShading: false,
      vertexColors: true,
      forceSinglePass: true,
      shininess: 25,
      specular: 0x555533,
      transparent: false,
      depthWrite: true,
    })
    this.materialCache.set(key, material)
    return material
  }

  static createProjectedMaterial(
    label: number,
    color: Color,
    size = 256
  ): MeshStandardMaterial {
    const key = `projected_${label}_${color.getHex()}_${size}`
    if (this.materialCache.has(key)) {
      return this.materialCache.get(key) as MeshStandardMaterial
    }

    const numberTexture = BallTextureFactory.getOrCreateTexture(
      label,
      color,
      size
    )

    const material =
      Session.getLod() <= 1
        ? new MeshStandardMaterial({
            color: color,
            roughness: 0.5,
            metalness: 0,
            // v1.3.93：去掉 flatShading。
            //
            // 原先低画质档（lod≤1）开 flatShading，本意是省一点着色开销，
            // 但副作用是**每个三角面用同一个面法线**——球面被显式地画成
            // 一堆可见的平面，棱角比几何细分度本身还刺眼。用户反馈的
            // 「球的锯齿也多」里，有一部分其实不是走样（MSAA 能治的那种），
            // 而是这个 flatShading 造成的**面片感**，MSAA 完全治不了。
            // 关掉它改用平滑法线后，配合 ballmesh 里提升的细分度，
            // 低画质档的球也恢复成连续曲面。
            flatShading: false,
            transparent: false,
            depthWrite: true,
          })
        : new MeshPhysicalMaterial({
            color: color,
            roughness: 0.1,
            metalness: 0,
            clearcoat: 1.0,
            clearcoatRoughness: 0.02,
            reflectivity: 0.25,
          })

    material.onBeforeCompile = (shader: any) => {
      shader.uniforms.numberTex = { value: numberTexture }
      shader.uniforms.invScale = { value: 1 / (R * 2) }

      shader.vertexShader = shader.vertexShader.replace(
        "#include <common>",
        `#include <common>
         varying vec3 vLocalPosition;`
      )
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         vLocalPosition = position;`
      )

      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <common>",
        `#include <common>
        uniform sampler2D numberTex;
        uniform float invScale;
        varying vec3 vLocalPosition;`
      )
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        // Calculate the base UV mapping
        vec2 projUv = vLocalPosition.xz * invScale + 0.5;

        // Flip logic for the bottom hemisphere (避免赤道处的纹理跳变)
        if (vLocalPosition.y < 0.0) {
          projUv.x = 1.0 - projUv.x;
        }

        projUv = clamp(projUv, 0.0, 1.0);

        // 使用标准 texture() 自动 LOD 采样：避免 textureGrad + 显式导数
        // 在部分移动 GPU 驱动上行为不稳导致着色器编译/采样异常。
        vec4 texColor = texture(numberTex, projUv);

        diffuseColor.rgb = texColor.rgb;`
      )
    }
    this.materialCache.set(key, material)
    return material
  }
}
