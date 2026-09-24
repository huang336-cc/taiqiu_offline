import { Vector3 } from "three"
import { Ball } from "../ball"
import { Collision } from "./collision"
import { I, m, R } from "./constants"
import { upCross } from "../../utils/three-utils"
import { exp } from "../../utils/utils"

/**
 * v1.3.94（斯登 / 跟杆 / 缩杆）：纵向自旋 → 撞后沿连心线速度的增益。
 *
 * 物理本质：白球撞击前的高低杆自旋（绕水平横向轴）在撞后转化为沿连心线
 * 的平动分量 —— 顶杆跟进、低杆回缩、中杆停球。增益把「自旋量」映射成
 * 「沿连心线速度」，取 0.5 为起手标定：
 *   · 中杆(offset.y=0)：rvel=0 → 母球撞后即停（斯登）；
 *   · 满跟进(offset.y≈+0.4)：母球沿连心线跟进约 0.6·V；
 *   · 满缩杆(offset.y≈−0.45)：母球回缩约 0.6·V。
 * 取值经验校准，详见 botmatch 回归（清台 100% / 均杆 ~11 / 摔袋 ~2~3% 红线）。
 */
const FOLLOW_GAIN = 0.5

const ab_v = new Vector3()
const abTangent_v = new Vector3()
const vPoint_v = new Vector3()
const vRelTangentialVec_v = new Vector3()
const impulseTangential_v = new Vector3()
const impulseNormal_v = new Vector3()
const angularImpulse_v = new Vector3()
const temp_v = new Vector3()

/**
 * Based on
 * https://billiards.colostate.edu/technical_proofs/new/TP_A-14.pdf
 *
 */
export class CollisionThrow {
  normalImpulse: number
  tangentialImpulse: number

  private dynamicFriction(vRel: number): number {
    return 0.01 + 0.108 * exp(-1.088 * vRel)
  }

  public updateVelocities(a: Ball, b: Ball) {
    const contact = Collision.positionsAtContact(a, b)
    a.ballmesh?.trace.forceTrace(contact.a)
    b.ballmesh?.trace.forceTrace(contact.b)
    const ab = ab_v.subVectors(contact.b, contact.a).normalize()
    const abTangent = abTangent_v.set(-ab.y, ab.x, 0)

    const e = 0.925
    const vPoint = vPoint_v
      .copy(a.vel)
      .sub(b.vel)
      .add(temp_v.copy(ab).multiplyScalar(-R).cross(a.rvel))
      .sub(temp_v.copy(ab).multiplyScalar(R).cross(b.rvel))

    const vRelNormalMag = ab.dot(vPoint)
    const vRelTangentialVec = vRelTangentialVec_v
      .copy(vPoint)
      .addScaledVector(ab, -vRelNormalMag)
    const vRelMag = vRelTangentialVec.length()

    const μ = this.dynamicFriction(vRelMag)

    // Normal impulse (inelastic collision)
    this.normalImpulse = (-(1 + e) * vRelNormalMag) / (2 / m)

    // Tangential impulse (frictional constraint)
    const impulseTangential = impulseTangential_v.set(0, 0, 0)
    if (vRelMag > 1e-8) {
      const maxJt_friction = μ * Math.abs(this.normalImpulse)
      const maxJt_stick = (m / 7) * vRelMag
      const jtMag = Math.min(maxJt_friction, maxJt_stick)
      impulseTangential.copy(vRelTangentialVec).multiplyScalar(-jtMag / vRelMag)
      this.tangentialImpulse = impulseTangential.dot(abTangent)
    } else {
      this.tangentialImpulse = 0
    }

    // Impulse vectors
    const impulseNormal = impulseNormal_v
      .copy(ab)
      .multiplyScalar(this.normalImpulse)

    // v1.3.94（跳球）：贴台才压平 z（详见 v1.3.94 改动说明）
    a.vel
      .addScaledVector(impulseNormal, 1 / m)
      .addScaledVector(impulseTangential, 1 / m)
    if (!a.isAirborne()) a.vel.z = 0
    b.vel
      .addScaledVector(impulseNormal, -1 / m)
      .addScaledVector(impulseTangential, -1 / m)
    if (!b.isAirborne()) b.vel.z = 0

    // Angular velocity updates
    // Jt is the tangential impulse applied TO ball A.
    // The force acts at the contact point relative to ball A: rA = R * ab
    // Torque for A: tauA = rA x Jt = (R * ab) x Jt
    // For ball B, the impulse is -Jt and it acts at rB = -R * ab
    // Torque for B: tauB = rB x (-Jt) = (-R * ab) x (-Jt) = (R * ab) x Jt
    // Thus both balls receive the SAME angular impulse.
    const angularImpulse = angularImpulse_v
      .copy(ab)
      .multiplyScalar(R)
      .cross(impulseTangential)

    a.rvel.addScaledVector(angularImpulse, 1 / I)
    b.rvel.addScaledVector(angularImpulse, 1 / I)

    // v1.3.94（斯登 / 跟杆 / 缩杆）：纵向自旋 → 撞后沿连心线速度。
    //
    // 此前此文件对两球施加「同向同量」的角冲量，纵向(高低杆)自旋完全不参与
    // 撞后平动 —— 斯登/跟进/缩杆在物理上毫无区别（母球一律按自然分离角走，
    // 等同斯登）。这里补上「白球纵向自旋 → 沿连心线速度」：
    //   顶杆(follow / offset.y>0) → 母球沿 ab 跟进；
    //   低杆(draw   / offset.y<0) → 母球沿 ab 回缩；
    //   中杆(stun   / offset.y=0) → 母球撞后即停（清除法向残余 ≈0.04V）。
    //
    // 仅作用于白球(a)：balls[0] 恒为白球、且碰撞对 (a,b) 排序保证 a<b，故白球
    // 参与的碰撞里 a 即白球；对象球之间不施加，避免改变其碰撞行为（守 AI 红线）。
    if (a.isCue) {
      const transverse = upCross(ab) // 水平、垂直于连心线：高低杆自旋轴
      const longSpin = a.rvel.dot(transverse) // 顶杆为正、缩杆为负（见 cueToSpin）
      // 与撞前自旋匹配的沿连心线速度：自然滚动 longSpin≈V/R → 跟进≈V·GAIN
      const followV = longSpin * R * FOLLOW_GAIN
      const curAlong = a.vel.dot(ab)
      a.vel.addScaledVector(ab, followV - curAlong)
    }

    return vRelNormalMag
  }
}
