/**
 * v1.8.6 验收探针：球桌外观只剩「经典原木」。
 *
 * 覆盖三件事：
 *  1. TABLE_SKINS 有且只有一款，id = classic；
 *  2. 任何历史 id（emerald / obsidian / lava …）与空串都回退到 classic —— 旧存档不会白屏；
 *  3. 旧存档里存着 obsidian 时，Settings.get() 把它归一为 classic（内存态与 UI 一致）。
 *
 * 运行：npx tsx tools/harness/tableskin186.ts
 */

const store: Record<string, string> = {}
;(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => (k in store ? store[k] : null),
  setItem: (k: string, v: string) => {
    store[k] = String(v)
  },
  removeItem: (k: string) => {
    delete store[k]
  },
  clear: () => {
    for (const k of Object.keys(store)) delete store[k]
  },
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
import { TABLE_SKINS, getTableSkin, Settings } from "../../src/utils/settings"

const fails: string[] = []
let pass = 0
function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    pass++
    console.log(`  ✅ ${name}`)
  } else {
    fails.push(name + (extra ? ` — ${extra}` : ""))
    console.log(`  ❌ ${name}${extra ? " — " + extra : ""}`)
  }
}

console.log("\n=== 1. 皮肤表只剩一款 ===")
check("TABLE_SKINS 长度 = 1", TABLE_SKINS.length === 1, `实际 ${TABLE_SKINS.length}`)
check("唯一款 id = classic", TABLE_SKINS[0]?.id === "classic", String(TABLE_SKINS[0]?.id))
check("名称 = 经典原木", TABLE_SKINS[0]?.name === "经典原木", String(TABLE_SKINS[0]?.name))
console.log(`     台呢 0x${TABLE_SKINS[0].clothColor.toString(16)} / 桌框 0x${TABLE_SKINS[0].frameColor.toString(16)}`)
check("台呢为墨绿 0x1f6b34", TABLE_SKINS[0].clothColor === 0x1f6b34)
check("桌框为原木 0x6a4a1a", TABLE_SKINS[0].frameColor === 0x6a4a1a)
check("无发光框（frameGlow = 0）", TABLE_SKINS[0].frameGlow === 0)

console.log("\n=== 2. 历史 id 全部回退 ===")
const legacy = [
  "emerald",
  "crimson",
  "sapphire",
  "golden",
  "obsidian",
  "lava",
  "neon",
  "crimsonGold",
  "holo",
  "candy",
  "emeraldGold",
  "violet",
  "",
  "nonexistent-id",
]
for (const id of legacy) {
  const def = getTableSkin(id)
  check(`getTableSkin("${id}") → classic`, def.id === "classic", def.id)
}

console.log("\n=== 3. 旧存档归一 ===")
store["billiards_cn_settings_v1"] = JSON.stringify({
  tableSkin: "obsidian",
  scene: "snow",
  cueTheme: "auto",
})
Settings.reload()
const s = Settings.get()
check("旧存档 obsidian → 内存 classic", s.tableSkin === "classic", s.tableSkin)
check("其它字段未被误改（scene）", s.scene === "snow", s.scene)

console.log("\n=== 4. 负向对照（表里不该再出现第二款）===")
const ids = TABLE_SKINS.map((x) => x.id)
check("没有 emerald/lava/obsidian 等残留", ids.length === 1 && ids[0] === "classic", ids.join(","))

console.log(`\n${fails.length === 0 ? "✅" : "❌"} 球桌外观 ${pass}/${pass + fails.length} 通过`)
fails.forEach((f) => console.log("   - " + f))
process.exit(fails.length === 0 ? 0 : 1)
