/*!
 * 球杆主题预览 —— three.js 3D 渲染（主题定制版 v1.3.35）
 * 由 menu-cn.js 在长按时按需初始化，使用 window.THREE（dist/three.standalone.js）。
 * 每个主题有独立的程序化纹理与几何造型。
 */
;(function (global) {
  "use strict"
  var THREE = global.THREE
  if (!THREE) {
    console.error("[cuePreview3D] window.THREE 未加载，无法初始化 3D 预览")
    return
  }

  // ---------- 颜色工具 ----------
  function hexToNum(hex) { return parseInt((hex || "#000000").replace("#", ""), 16) }

  function parseColor(hex) {
    var n = hexToNum(hex)
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
  }

  function rgbToHex(c) {
    return "#" + ((1 << 24) + (clamp(c.r) << 16) + (clamp(c.g) << 8) + clamp(c.b)).toString(16).slice(1)
  }

  function clamp(v) { return Math.max(0, Math.min(255, Math.round(v))) }

  function adjust(hex, factor) {
    var c = parseColor(hex)
    return rgbToHex({ r: c.r * factor, g: c.g * factor, b: c.b * factor })
  }

  function mix(a, b, t) {
    var ca = parseColor(a), cb = parseColor(b)
    return rgbToHex({ r: ca.r + (cb.r - ca.r) * t, g: ca.g + (cb.g - ca.g) * t, b: ca.b + (cb.b - ca.b) * t })
  }

  function brighten(hex, amt) {
    var c = parseColor(hex)
    return rgbToHex({ r: c.r + amt, g: c.g + amt, b: c.b + amt })
  }

  function darken(hex, amt) { return brighten(hex, -amt) }

  function luma(hex) {
    var c = parseColor(hex)
    return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b
  }

  function withAlpha(hex, a) {
    var c = parseColor(hex)
    return "rgba(" + c.r + "," + c.g + "," + c.b + "," + a + ")"
  }

  // ---------- 通用 Canvas 绘制工具 ----------
  function clear(ctx, w, h, color) {
    ctx.fillStyle = color
    ctx.fillRect(0, 0, w, h)
  }

  function noise(ctx, w, h, density, minA, maxA, color) {
    ctx.save()
    for (var i = 0; i < density; i++) {
      var a = minA + Math.random() * (maxA - minA)
      ctx.fillStyle = withAlpha(color || "#000000", a)
      ctx.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2)
    }
    ctx.restore()
  }

  function stripe(ctx, w, h, color, width, tilt) {
    ctx.save()
    ctx.strokeStyle = color
    ctx.lineWidth = width
    for (var x = -w; x < w * 2; x += width * 2) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x + w * tilt, h)
      ctx.stroke()
    }
    ctx.restore()
  }

  function radialGlow(ctx, w, h, color, r) {
    var g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, r || w * 0.7)
    g.addColorStop(0, withAlpha(color, 0.35))
    g.addColorStop(1, withAlpha(color, 0))
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  }

  function gradV(ctx, w, h, top, bot) {
    var g = ctx.createLinearGradient(0, 0, 0, h)
    g.addColorStop(0, top)
    g.addColorStop(1, bot)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  }

  // ---------- 主题配置表 ----------
  var THEMES = {
    // 默认 / 旧主题：保留通用木纹+皮革
    auto: {
      prepare: function (c1, c2) { return { shaft: c1, grip: c2, metal: "#c9a24b", tip: deriveTip(c2) } },
      shaft: woodTexture,
      grip: leatherTexture,
      metal: plainMetal
    },

    // 1. 墨云龙阙
    moyunlongque: {
      prepare: function (c1, c2) {
        return {
          shaft: mix(c1, "#1a1a1a", 0.55),
          grip: mix(c2, "#0f0d0a", 0.5),
          metal: "#6a6a6a",
          tip: "#e8e0d0",
          accent: "#c9a24b"
        }
      },
      shaft: function (ctx, w, h, cols) {
        gradV(ctx, w, h, cols.shaft, darken(cols.shaft, 30))
        // 云纹
        ctx.save()
        ctx.globalCompositeOperation = "overlay"
        for (var i = 0; i < 8; i++) {
          ctx.strokeStyle = withAlpha(cols.accent, 0.12)
          ctx.lineWidth = 3 + Math.random() * 2
          ctx.beginPath()
          var y = Math.random() * h
          ctx.moveTo(0, y)
          ctx.bezierCurveTo(w * 0.3, y - 30, w * 0.7, y + 30, w, y)
          ctx.stroke()
        }
        ctx.restore()
        // 龙鳞暗纹
        ctx.save()
        for (var row = 0; row < 10; row++) {
          for (var col = 0; col < 5; col++) {
            var cx = (col + 0.5) * (w / 5) + (row % 2) * (w / 10)
            var cy = (row + 0.5) * (h / 10)
            ctx.strokeStyle = withAlpha(cols.accent, 0.18)
            ctx.lineWidth = 1
            ctx.beginPath()
            ctx.arc(cx, cy, w / 14, 0, Math.PI, true)
            ctx.stroke()
          }
        }
        ctx.restore()
        noise(ctx, w, h, 800, 0.03, 0.08, "#000000")
      },
      grip: function (ctx, w, h, cols) {
        clear(ctx, w, h, cols.grip)
        woodTexture(ctx, w, h, { shaft: cols.grip, grip: darken(cols.grip, 40) })
        noise(ctx, w, h, 600, 0.05, 0.12, "#000000")
      },
      metal: function (ctx, w, h, cols) {
        clear(ctx, w, h, cols.metal)
        noise(ctx, w, h, 300, 0.05, 0.15, "#ffffff")
        ctx.strokeStyle = withAlpha(cols.accent, 0.3)
        ctx.lineWidth = 1
        for (var i = 0; i < 3; i++) {
          ctx.beginPath()
          ctx.moveTo(0, h * 0.3 + i * h * 0.2)
          ctx.quadraticCurveTo(w / 2, h * 0.3 + i * h * 0.2 - 5, w, h * 0.3 + i * h * 0.2)
          ctx.stroke()
        }
      },
      params: { shaft: { roughness: 0.75, metalness: 0.1 }, grip: { roughness: 0.9 }, metal: { metalness: 0.7, roughness: 0.35 } }
    },

    // 2. 青竹听风
    qingzhutingfeng: {
      prepare: function (c1, c2) {
        return { shaft: c1, grip: c2, metal: "#a0c0a0", tip: c2 }
      },
      shaft: function (ctx, w, h, cols) {
        gradV(ctx, w, h, brighten(cols.shaft, 20), cols.shaft)
        // 竹节
        var segH = h / 6
        ctx.strokeStyle = withAlpha("#e0ffe0", 0.55)
        ctx.lineWidth = 2
        for (var i = 1; i < 6; i++) {
          var y = i * segH
          ctx.beginPath()
          ctx.moveTo(0, y)
          ctx.lineTo(w, y)
          ctx.stroke()
          // 竹节边缘银线
          ctx.strokeStyle = withAlpha("#ffffff", 0.25)
          ctx.lineWidth = 1
          ctx.beginPath(); ctx.moveTo(0, y - 3); ctx.lineTo(w, y - 3); ctx.stroke()
          ctx.beginPath(); ctx.moveTo(0, y + 3); ctx.lineTo(w, y + 3); ctx.stroke()
        }
        // 纵向竹丝
        ctx.strokeStyle = withAlpha("#ffffff", 0.12)
        ctx.lineWidth = 1
        for (var x = 0; x < w; x += 8) {
          ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke()
        }
      },
      grip: function (ctx, w, h, cols) {
        clear(ctx, w, h, cols.grip)
        // 竹根粗糙纹理
        noise(ctx, w, h, 1200, 0.05, 0.18, "#1a3a1a")
        ctx.strokeStyle = withAlpha("#5a9a5a", 0.25)
        ctx.lineWidth = 2
        for (var i = 0; i < 8; i++) {
          var y = Math.random() * h
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y + (Math.random() - 0.5) * 10); ctx.stroke()
        }
      },
      geometry: { butt: "round-root", noMetalRing: true },
      params: { shaft: { roughness: 0.6 }, grip: { roughness: 0.95 } }
    },

    // 3. 凤羽鎏金
    fengyuliujin: {
      prepare: function (c1, c2) {
        return {
          shaft: c1,
          grip: c2,
          metal: "#c9a24b",
          tip: "#f0e6d0",
          accent: "#ff8fc0"
        }
      },
      shaft: function (ctx, w, h, cols) {
        clear(ctx, w, h, cols.shaft)
        // 鲍鱼贝羽翼贴片
        for (var i = 0; i < 7; i++) {
          var y = (i + 0.5) * (h / 7)
          var iw = w * 0.6
          var ix = (w - iw) / 2
          var g = ctx.createLinearGradient(ix, y - 20, ix + iw, y + 20)
          g.addColorStop(0, withAlpha(cols.accent, 0.25))
          g.addColorStop(0.5, withAlpha("#40e0ff", 0.35))
          g.addColorStop(1, withAlpha(cols.metal, 0.25))
          ctx.fillStyle = g
          ctx.beginPath()
          ctx.ellipse(w / 2, y, iw / 2, 18, 0, 0, Math.PI * 2)
          ctx.fill()
          // 鎏金勾边
          ctx.strokeStyle = withAlpha(cols.metal, 0.55)
          ctx.lineWidth = 1.5
          ctx.stroke()
        }
        noise(ctx, w, h, 500, 0.03, 0.08, "#ffffff")
      },
      grip: function (ctx, w, h, cols) {
        clear(ctx, w, h, cols.grip)
        // 编织缠线
        ctx.strokeStyle = withAlpha(cols.metal, 0.25)
        ctx.lineWidth = 2
        for (var i = -h; i < w + h; i += 10) {
          ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + h * 0.6, h); ctx.stroke()
          ctx.beginPath(); ctx.moveTo(i + h * 0.6, 0); ctx.lineTo(i, h); ctx.stroke()
        }
      },
      metal: function (ctx, w, h, cols) {
        clear(ctx, w, h, cols.metal)
        noise(ctx, w, h, 200, 0.05, 0.2, "#ffffff")
        ctx.strokeStyle = withAlpha("#fff0c0", 0.4)
        ctx.lineWidth = 1
        for (var i = 0; i < 4; i++) {
          ctx.beginPath()
          ctx.moveTo(0, h * 0.25 + i * h * 0.18)
          ctx.quadraticCurveTo(w / 2, h * 0.25 + i * h * 0.18 - 8, w, h * 0.25 + i * h * 0.18)
          ctx.stroke()
        }
      },
      geometry: { butt: "feather-ring" },
      params: { shaft: { roughness: 0.45, metalness: 0.25 }, metal: { metalness: 0.9, roughness: 0.2 } }
    },

    // 4. 千里砚山
    qianliyanshan: {
      prepare: function (c1, c2) {
        return { shaft: c1, grip: c2, metal: "#5a6a70", tip: c1 }
      },
      shaft: function (ctx, w, h, cols) {
        clear(ctx, w, h, cols.shaft)
        // 淡墨山水
        ctx.fillStyle = withAlpha("#3a4a50", 0.15)
        for (var i = 0; i < 5; i++) {
          var y = h * 0.5 + i * 15
          ctx.beginPath()
          ctx.moveTo(0, y)
          ctx.bezierCurveTo(w * 0.25, y - 30 - i * 10, w * 0.75, y - 20 - i * 8, w, y - 10)
          ctx.lineTo(w, h)
          ctx.lineTo(0, h)
          ctx.fill()
        }
        noise(ctx, w, h, 700, 0.04, 0.1, "#2a3a40")
      },
      grip: function (ctx, w, h, cols) {
        clear(ctx, w, h, cols.grip)
        noise(ctx, w, h, 1500, 0.08, 0.2, "#1a2a30")
      },
      geometry: { butt: "inkstone", noMetalRing: true },
      params: { shaft: { roughness: 0.95, metalness: 0 }, grip: { roughness: 1.0 } }
    },

    // 5. 星核暗芒
    xinghedanmang: {
      prepare: function (c1, c2) {
        return { shaft: c1, grip: c2, metal: "#4a5a70", tip: c2, accent: "#60d0ff" }
      },
      shaft: function (ctx, w, h, cols) {
        clear(ctx, w, h, cols.shaft)
        // 星尘
        for (var i = 0; i < 200; i++) {
          ctx.fillStyle = withAlpha("#ffffff", 0.3 + Math.random() * 0.5)
          ctx.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random(), 1 + Math.random())
        }
        // 青蓝电路纹螺旋
        ctx.strokeStyle = withAlpha(cols.accent, 0.55)
        ctx.lineWidth = 1.5
        ctx.beginPath()
        for (var y = 0; y < h; y += 4) {
          var x = w / 2 + Math.sin(y * 0.04) * (w * 0.35)
          if (y === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
        }
        ctx.stroke()
        noise(ctx, w, h, 400, 0.03, 0.08, "#000000")
      },
      grip: function (ctx, w, h, cols) {
        clear(ctx, w, h, cols.grip)
        // 点阵
        ctx.fillStyle = withAlpha(cols.accent, 0.25)
        for (var y = 4; y < h; y += 8) {
          for (var x = 4; x < w; x += 8) {
            if (Math.random() > 0.4) ctx.fillRect(x, y, 2, 2)
          }
        }
      },
      metal: function (ctx, w, h, cols) {
        clear(ctx, w, h, cols.metal)
        noise(ctx, w, h, 300, 0.05, 0.15, "#a0c0e0")
        // 电路标识
        ctx.strokeStyle = withAlpha(cols.accent, 0.5)
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.arc(w / 2, h / 2, w / 5, 0, Math.PI * 2)
        ctx.stroke()
        ctx.beginPath(); ctx.moveTo(w / 2, h * 0.25); ctx.lineTo(w / 2, h * 0.75); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(w * 0.3, h / 2); ctx.lineTo(w * 0.7, h / 2); ctx.stroke()
      },
      geometry: { butt: "circuit-disc" },
      params: { shaft: { roughness: 0.4, metalness: 0.6 }, grip: { roughness: 0.7 }, metal: { metalness: 0.8, roughness: 0.3 } }
    },

    // 6. 霓虹溯光
    nihongsuguang: {
      prepare: function (c1, c2) {
        return { shaft: c1, grip: c2, metal: "#a0a0ff", tip: c1, accent: "#40c0ff" }
      },
      shaft: function (ctx, w, h, cols) {
        // 半透深紫底
        clear(ctx, w, h, cols.shaft)
        // 内部粉蓝渐变带状结构
        for (var i = 0; i < 3; i++) {
          var g = ctx.createLinearGradient(0, 0, w, h)
          g.addColorStop(0, withAlpha(cols.shaft, 0.2))
          g.addColorStop(0.5, withAlpha(cols.accent, 0.45))
          g.addColorStop(1, withAlpha("#ff60d0", 0.35))
          ctx.fillStyle = g
          ctx.beginPath()
          var off = i * 40
          ctx.moveTo(w * 0.2 + off, 0)
          ctx.bezierCurveTo(w * 0.8 + off, h * 0.3, w * 0.2 + off, h * 0.7, w * 0.8 + off, h)
          ctx.lineTo(w * 0.6 + off, h)
          ctx.bezierCurveTo(w * 0.0 + off, h * 0.7, w * 0.6 + off, h * 0.3, w * 0.4 + off, 0)
          ctx.fill()
        }
      },
      grip: function (ctx, w, h, cols) {
        clear(ctx, w, h, cols.grip)
        ctx.strokeStyle = withAlpha("#ffffff", 0.15)
        ctx.lineWidth = 3
        for (var x = 6; x < w; x += 12) {
          ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke()
        }
      },
      metal: function (ctx, w, h, cols) {
        var g = ctx.createLinearGradient(0, 0, w, h)
        g.addColorStop(0, "#e0e0ff")
        g.addColorStop(0.5, "#8080ff")
        g.addColorStop(1, "#e0e0ff")
        ctx.fillStyle = g
        ctx.fillRect(0, 0, w, h)
      },
      geometry: { butt: "poly-metal" },
      params: {
        shaft: { transparent: true, opacity: 0.82, roughness: 0.15, metalness: 0.1 },
        grip: { roughness: 0.6 },
        metal: { metalness: 0.95, roughness: 0.05 }
      }
    },

    // 7. 虚空裂隙
    xukonglilie: {
      prepare: function (c1, c2) {
        return { shaft: c1, grip: c2, metal: "#4a4a52", tip: c2, accent: "#8a40ff" }
      },
      shaft: function (ctx, w, h, cols) {
        clear(ctx, w, h, cols.shaft)
        // 纵向裂隙
        for (var i = 0; i < 5; i++) {
          var x = (i + 1) * (w / 6)
          var g = ctx.createLinearGradient(x - 6, 0, x + 6, 0)
          g.addColorStop(0, withAlpha(cols.shaft, 0))
          g.addColorStop(0.5, withAlpha(cols.accent, 0.55))
          g.addColorStop(1, withAlpha(cols.shaft, 0))
          ctx.fillStyle = g
          ctx.fillRect(x - 6, 0, 12, h)
        }
        noise(ctx, w, h, 500, 0.05, 0.12, "#000000")
      },
      grip: leatherTexture,
      metal: function (ctx, w, h, cols) {
        clear(ctx, w, h, cols.metal)
        noise(ctx, w, h, 250, 0.05, 0.15, "#a0a0a0")
      },
      geometry: { butt: "blunt-cone" },
      params: { shaft: { roughness: 0.45, metalness: 0.7 }, grip: { roughness: 0.85 }, metal: { metalness: 0.8, roughness: 0.35 } }
    },

    // 8. 幽刺夜影
    youciyeying: {
      prepare: function (c1, c2) {
        return { shaft: c1, grip: c2, metal: "#5a5a62", tip: c2, accent: "#80ffd0" }
      },
      shaft: function (ctx, w, h, cols) {
        clear(ctx, w, h, cols.shaft)
        // 放射尖刺暗纹
        ctx.strokeStyle = withAlpha("#2a2a32", 0.5)
        ctx.lineWidth = 2
        for (var i = 0; i < 24; i++) {
          var ang = (i / 24) * Math.PI * 2
          ctx.beginPath()
          ctx.moveTo(w / 2, h / 2)
          ctx.lineTo(w / 2 + Math.cos(ang) * w * 0.6, h / 2 + Math.sin(ang) * h * 0.6)
          ctx.stroke()
        }
        // 小块贝母珠光
        for (var k = 0; k < 12; k++) {
          var bx = Math.random() * w
          var by = Math.random() * h
          var g = ctx.createRadialGradient(bx, by, 0, bx, by, 15)
          g.addColorStop(0, withAlpha(cols.accent, 0.35))
          g.addColorStop(1, withAlpha(cols.accent, 0))
          ctx.fillStyle = g
          ctx.beginPath(); ctx.arc(bx, by, 15, 0, Math.PI * 2); ctx.fill()
        }
      },
      grip: function (ctx, w, h, cols) {
        clear(ctx, w, h, cols.grip)
        // 虎纹压花
        for (var i = 0; i < 30; i++) {
          ctx.fillStyle = withAlpha("#1a1a1e", 0.2)
          var x = Math.random() * w
          var y = Math.random() * h
          var rw = 20 + Math.random() * 30
          var rh = 8 + Math.random() * 12
          ctx.beginPath(); ctx.ellipse(x, y, rw, rh, Math.random() * Math.PI, 0, Math.PI * 2); ctx.fill()
        }
        noise(ctx, w, h, 600, 0.04, 0.1, "#000000")
      },
      geometry: { butt: "small-cone" },
      params: { shaft: { roughness: 0.35, metalness: 0.6 }, grip: { roughness: 0.8 }, metal: { metalness: 0.75, roughness: 0.4 } }
    },

    // 9. 烬火焚风
    jinhuofengfeng: {
      prepare: function (c1, c2) {
        return { shaft: c1, grip: c2, metal: "#5a3a2a", tip: "#8a1a0a", accent: "#ff3a1a" }
      },
      shaft: function (ctx, w, h, cols) {
        // 黑红渐变底
        var g = ctx.createLinearGradient(0, 0, 0, h)
        g.addColorStop(0, cols.shaft)
        g.addColorStop(1, cols.grip)
        ctx.fillStyle = g
        ctx.fillRect(0, 0, w, h)
        // 熔岩龟裂
        ctx.strokeStyle = withAlpha(cols.accent, 0.55)
        ctx.lineWidth = 2
        for (var i = 0; i < 18; i++) {
          ctx.beginPath()
          var x = Math.random() * w
          var y = Math.random() * h
          ctx.moveTo(x, y)
          for (var j = 0; j < 5; j++) {
            x += (Math.random() - 0.5) * w * 0.3
            y += (Math.random() - 0.5) * h * 0.15
            ctx.lineTo(x, y)
          }
          ctx.stroke()
        }
        // 裂纹发光
        ctx.strokeStyle = withAlpha(cols.accent, 0.2)
        ctx.lineWidth = 4
        for (var i = 0; i < 18; i++) {
          ctx.beginPath()
          var x = Math.random() * w
          var y = Math.random() * h
          ctx.moveTo(x, y)
          for (var j = 0; j < 5; j++) {
            x += (Math.random() - 0.5) * w * 0.3
            y += (Math.random() - 0.5) * h * 0.15
            ctx.lineTo(x, y)
          }
          ctx.stroke()
        }
      },
      grip: function (ctx, w, h, cols) {
        clear(ctx, w, h, cols.grip)
        noise(ctx, w, h, 1000, 0.08, 0.2, "#3a0a05")
        stripe(ctx, w, h, withAlpha("#5a1a0a", 0.25), 4, 0.1)
      },
      geometry: { butt: "lava-rock" },
      params: { shaft: { roughness: 0.85, emissive: 0xff3a1a, emissiveIntensity: 0.15 }, grip: { roughness: 0.9 } }
    },

    // 10. 云糖幻梦
    yuntianghuanmeng: {
      prepare: function (c1, c2) {
        return { shaft: c1, grip: c2, metal: "#ffc0e0", tip: c1 }
      },
      shaft: function (ctx, w, h, cols) {
        // 粉白渐变半透底
        var g = ctx.createLinearGradient(0, 0, 0, h)
        g.addColorStop(0, withAlpha(cols.shaft, 0.85))
        g.addColorStop(0.5, withAlpha("#ffffff", 0.55))
        g.addColorStop(1, withAlpha(cols.grip, 0.75))
        ctx.fillStyle = g
        ctx.fillRect(0, 0, w, h)
        // 柔和云朵暗纹
        for (var i = 0; i < 6; i++) {
          var cx = Math.random() * w
          var cy = Math.random() * h
          var rg = ctx.createRadialGradient(cx, cy, 5, cx, cy, 40)
          rg.addColorStop(0, withAlpha("#ffffff", 0.25))
          rg.addColorStop(1, withAlpha("#ffffff", 0))
          ctx.fillStyle = rg
          ctx.beginPath(); ctx.arc(cx, cy, 40, 0, Math.PI * 2); ctx.fill()
        }
      },
      grip: function (ctx, w, h, cols) {
        clear(ctx, w, h, cols.grip)
        noise(ctx, w, h, 600, 0.04, 0.1, "#ffffff")
      },
      geometry: { butt: "round-soft", noMetalRing: true },
      params: { shaft: { transparent: true, opacity: 0.78, roughness: 0.25 }, grip: { roughness: 0.5 } }
    },

    // 11. 冰晶雪魄
    bingjingxuepo: {
      prepare: function (c1, c2) {
        return { shaft: c1, grip: c2, metal: "#d0e8ff", tip: c1, accent: "#a0d0ff" }
      },
      shaft: function (ctx, w, h, cols) {
        clear(ctx, w, h, cols.shaft)
        // 冰棱丝状纹
        ctx.strokeStyle = withAlpha(cols.accent, 0.35)
        ctx.lineWidth = 1.5
        for (var i = 0; i < 20; i++) {
          var x = Math.random() * w
          ctx.beginPath(); ctx.moveTo(x, 0)
          for (var y = 0; y < h; y += 10) {
            x += (Math.random() - 0.5) * 4
            ctx.lineTo(x, y)
          }
          ctx.stroke()
        }
        // 切面高光
        ctx.strokeStyle = withAlpha("#ffffff", 0.35)
        ctx.lineWidth = 2
        ctx.beginPath(); ctx.moveTo(w * 0.2, 0); ctx.lineTo(w * 0.2, h); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(w * 0.8, 0); ctx.lineTo(w * 0.8, h); ctx.stroke()
      },
      grip: function (ctx, w, h, cols) {
        clear(ctx, w, h, cols.grip)
        noise(ctx, w, h, 800, 0.05, 0.12, "#6080a0")
      },
      geometry: { butt: "ice-crystal" },
      params: { shaft: { transparent: true, opacity: 0.85, roughness: 0.2, metalness: 0.15 }, grip: { roughness: 0.55 } }
    },

    // 12. 万象权杖
    wanxiangquanzhang: {
      prepare: function (c1, c2) {
        return { shaft: c2, grip: c2, metal: c1, tip: "#f0e6d0", accent: c1 }
      },
      shaft: function (ctx, w, h, cols) {
        clear(ctx, w, h, cols.shaft)
        // 欧式几何浮雕
        ctx.strokeStyle = withAlpha(cols.metal, 0.45)
        ctx.lineWidth = 2
        for (var i = 0; i < 8; i++) {
          var y = (i + 0.5) * (h / 8)
          ctx.beginPath()
          ctx.moveTo(w * 0.1, y)
          ctx.lineTo(w * 0.3, y - 10)
          ctx.lineTo(w * 0.5, y)
          ctx.lineTo(w * 0.7, y + 10)
          ctx.lineTo(w * 0.9, y)
          ctx.stroke()
        }
        // 竖向雕花
        ctx.strokeStyle = withAlpha(cols.metal, 0.3)
        ctx.lineWidth = 1
        for (var x = 0; x < w; x += 12) {
          ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke()
        }
        noise(ctx, w, h, 400, 0.03, 0.08, "#000000")
      },
      grip: function (ctx, w, h, cols) {
        clear(ctx, w, h, cols.grip)
        // 手工缠绕皮线
        ctx.strokeStyle = withAlpha(cols.metal, 0.35)
        ctx.lineWidth = 2
        for (var i = -h; i < w + h; i += 8) {
          ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + h * 0.4, h); ctx.stroke()
        }
      },
      metal: function (ctx, w, h, cols) {
        var g = ctx.createLinearGradient(0, 0, w, 0)
        g.addColorStop(0, cols.metal)
        g.addColorStop(0.5, brighten(cols.metal, 40))
        g.addColorStop(1, cols.metal)
        ctx.fillStyle = g
        ctx.fillRect(0, 0, w, h)
        noise(ctx, w, h, 150, 0.05, 0.15, "#ffffff")
        // 卷草纹
        ctx.strokeStyle = withAlpha("#3a2a10", 0.35)
        ctx.lineWidth = 1
        ctx.beginPath(); ctx.arc(w / 2, h / 2, w / 4, 0, Math.PI * 2); ctx.stroke()
      },
      geometry: { butt: "ornate-disc" },
      params: { shaft: { roughness: 0.4, metalness: 0.5 }, grip: { roughness: 0.75 }, metal: { metalness: 0.9, roughness: 0.2 } }
    }
  }

  // 默认/旧主题使用的通用纹理
  function woodTexture(ctx, w, h, cols) {
    clear(ctx, w, h, cols.shaft || cols.grip || "#d2b48c")
    var base = cols.shaft || cols.grip || "#d2b48c"
    var dark = cols.grip || "#5a4a3a"
    for (var i = 0; i < 160; i++) {
      var t = Math.random()
      var c = mix(base, dark, t)
      ctx.strokeStyle = withAlpha(c, 0.25)
      ctx.lineWidth = 1 + Math.random() * 2.5
      var y = Math.random() * h
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.bezierCurveTo(w * 0.3, y + (Math.random() - 0.5) * 40,
                         w * 0.7, y + (Math.random() - 0.5) * 40,
                         w, y + (Math.random() - 0.5) * 20)
      ctx.stroke()
    }
    var g = ctx.createLinearGradient(0, 0, w, 0)
    g.addColorStop(0, "rgba(255,255,255,0)")
    g.addColorStop(0.5, "rgba(255,255,255,0.06)")
    g.addColorStop(1, "rgba(255,255,255,0)")
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h)
  }

  function leatherTexture(ctx, w, h, cols) {
    clear(ctx, w, h, cols.grip || "#332222")
    var base = cols.grip || "#332222"
    noise(ctx, w, h, 5000, 0.05, 0.15, "#000000")
    ctx.strokeStyle = withAlpha("#000000", 0.12)
    ctx.lineWidth = 1
    for (var j = 0; j < h; j += 6) {
      ctx.beginPath(); ctx.moveTo(0, j); ctx.lineTo(w, j); ctx.stroke()
    }
  }

  function plainMetal(ctx, w, h, cols) {
    clear(ctx, w, h, cols.metal || "#c9a24b")
    noise(ctx, w, h, 200, 0.05, 0.2, "#ffffff")
  }

  function deriveTip(hex) {
    return adjust(hex || "#1a1a1a", 0.55)
  }

  function getTheme(pattern) {
    return THEMES[pattern] || THEMES.auto
  }

  function makeTexture(drawFn, colors) {
    var size = 512
    var canvas = document.createElement("canvas")
    canvas.width = size; canvas.height = size
    var ctx = canvas.getContext("2d")
    drawFn(ctx, size, size, colors)
    var tex = new THREE.CanvasTexture(canvas)
    tex.wrapS = THREE.RepeatWrapping
    tex.wrapT = THREE.RepeatWrapping
    tex.repeat.set(1, 3)
    return tex
  }

  function makeFloorTexture() {
    var size = 512
    var canvas = document.createElement("canvas")
    canvas.width = size; canvas.height = size
    var ctx = canvas.getContext("2d")
    var grad = ctx.createRadialGradient(size / 2, size / 2, 20, size / 2, size / 2, size * 0.7)
    grad.addColorStop(0, "rgba(30,45,75,0.55)")
    grad.addColorStop(0.6, "rgba(12,18,35,0.35)")
    grad.addColorStop(1, "rgba(10,16,32,0)")
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, size, size)
    var tex = new THREE.CanvasTexture(canvas)
    tex.wrapS = THREE.ClampToEdgeWrapping
    tex.wrapT = THREE.ClampToEdgeWrapping
    return tex
  }

  function useLowQuality(renderer) {
    if (!renderer) return true
    var cap = renderer.capabilities
    if (!cap) return true
    if (cap.maxVertexTextures === 0) return true
    return false
  }

  // ---------- 球杆几何组装 ----------
  function buildCue(opts, quality) {
    try {
    var pattern = opts.pattern || "auto"
    var theme = getTheme(pattern)
    var colors = theme.prepare ? theme.prepare(opts.wood, opts.dark) : { shaft: opts.wood, grip: opts.dark, metal: opts.metal, tip: opts.tip }
    colors.metal = colors.metal || opts.metal
    colors.tip = colors.tip || opts.tip

    var group = new THREE.Group()
    var L = 5.0
    var segs = 40
    var isLow = quality === "low"

    function mat(color, params) {
      params = params || {}
      var p = { color: hexToNum(color) }
      if (params.map) p.map = params.map
      if (params.shininess != null) p.shininess = params.shininess
      if (params.specular != null) p.specular = params.specular
      if (params.metalness != null) p.metalness = params.metalness
      if (params.roughness != null) p.roughness = params.roughness
      if (params.transparent) { p.transparent = true; p.opacity = params.opacity || 0.8 }
      if (params.emissive != null) p.emissive = params.emissive
      if (params.emissiveIntensity != null) p.emissiveIntensity = params.emissiveIntensity
      // v1.3.38-fix：低端机不再强制 Lambert（太平、像塑料），统一用 Phong 以获得高光与立体感；
      // 若调用方没传 specular/shininess，则补一个柔和默认高光，避免死灰。
      if (p.specular == null && p.metalness == null && p.roughness == null) {
        p.specular = 0x333333
        p.shininess = p.shininess || 35
      }
      if (params.metalness != null || params.roughness != null) return new THREE.MeshStandardMaterial(p)
      return new THREE.MeshPhongMaterial(p)
    }

    var shaftTex = makeTexture(theme.shaft || woodTexture, colors)
    var gripTex = makeTexture(theme.grip || leatherTexture, colors)
    var metalTex = theme.metal ? makeTexture(theme.metal, colors) : null

    var p = theme.params || {}

    function seg(y0, y1, rTop, rBot, material) {
      var h = y1 - y0
      var geo = new THREE.CylinderGeometry(rTop, rBot, h, segs, 1, false)
      var mesh = new THREE.Mesh(geo, material)
      mesh.position.y = (y0 + y1) / 2
      return mesh
    }

    var buttColor = colors.grip
    var gripColor = colors.grip
    var shaftColor = colors.shaft
    var metalColor = colors.metal
    var tipColor = colors.tip

    var buttR = 0.28, gripR = 0.24, shaftR = 0.19, ferruleR = 0.155, tipR = 0.12
    var buttEnd = -L / 2 + 1.1
    var ringEnd = buttEnd + 0.22
    var gripEnd = -L / 2 + 2.8
    var shaftEnd = L / 2 - 0.42
    var ferruleEnd = L / 2 - 0.12

    // 杆尾 butt
    var buttStyle = theme.geometry && theme.geometry.butt
    if (buttStyle === "round-root" || buttStyle === "round-soft") {
      // 圆润杆尾
      group.add(seg(-L / 2, buttEnd, buttR * 0.85, buttR, mat(buttColor, { map: gripTex, roughness: 0.8 })))
    } else if (buttStyle === "inkstone") {
      // 方正小砚台
      var box = new THREE.Mesh(
        new THREE.BoxGeometry(buttR * 2.4, 0.6, buttR * 1.8),
        mat(buttColor, { roughness: 0.95 })
      )
      box.position.y = -L / 2 + 0.35
      group.add(box)
      group.add(seg(buttEnd - 0.1, buttEnd, buttR * 0.9, buttR, mat(buttColor, { map: gripTex })))
    } else if (buttStyle === "lava-rock") {
      // 不规则熔岩岩石
      for (var i = 0; i < 8; i++) {
        var s = 0.12 + Math.random() * 0.14
        var rock = new THREE.Mesh(
          new THREE.DodecahedronGeometry(s, 0),
          mat(buttColor, { roughness: 0.95 })
        )
        rock.position.set((Math.random() - 0.5) * buttR * 2, -L / 2 + Math.random() * 0.5, (Math.random() - 0.5) * buttR * 2)
        group.add(rock)
      }
      group.add(seg(-L / 2 + 0.5, buttEnd, buttR * 0.8, buttR, mat(buttColor, { map: gripTex })))
    } else if (buttStyle === "ice-crystal") {
      // 多面冰晶
      var crystal = new THREE.Mesh(
        new THREE.ConeGeometry(buttR * 1.4, 0.8, 6),
        mat("#eaf6ff", { transparent: true, opacity: 0.75, roughness: 0.2 })
      )
      crystal.position.y = -L / 2 + 0.45
      crystal.rotation.x = Math.PI
      group.add(crystal)
      group.add(seg(-L / 2 + 0.55, buttEnd, buttR * 0.85, buttR, mat(buttColor, { map: gripTex })))
    } else if (buttStyle === "ornate-disc") {
      // 宽大圆形鎏金浮雕饰盘
      var disc = new THREE.Mesh(
        new THREE.CylinderGeometry(buttR * 1.8, buttR * 1.8, 0.18, 48),
        mat(metalColor, { metalness: 0.9, roughness: 0.2, map: metalTex })
      )
      disc.position.y = -L / 2 + 0.5
      group.add(disc)
      group.add(seg(-L / 2 + 0.65, buttEnd, buttR * 0.9, buttR, mat(buttColor, { map: gripTex })))
    } else if (buttStyle === "circuit-disc") {
      var disc2 = new THREE.Mesh(
        new THREE.CylinderGeometry(buttR * 1.1, buttR * 1.1, 0.12, 32),
        mat(metalColor, { metalness: 0.8, roughness: 0.3, map: metalTex })
      )
      disc2.position.y = -L / 2 + 0.45
      group.add(disc2)
      group.add(seg(-L / 2 + 0.6, buttEnd, buttR * 0.85, buttR, mat(buttColor, { map: gripTex })))
    } else if (buttStyle === "feather-ring") {
      var ring = new THREE.Mesh(
        new THREE.TorusGeometry(buttR * 1.1, 0.06, 12, 48),
        mat(metalColor, { metalness: 0.9, roughness: 0.2, map: metalTex })
      )
      ring.rotation.x = Math.PI / 2
      ring.position.y = -L / 2 + 0.45
      group.add(ring)
      group.add(seg(-L / 2 + 0.6, buttEnd, buttR * 0.9, buttR, mat(buttColor, { map: gripTex })))
    } else if (buttStyle === "blunt-cone") {
      var cone = new THREE.Mesh(
        new THREE.CylinderGeometry(buttR * 0.6, buttR * 1.1, 0.6, 32),
        mat(metalColor, { metalness: 0.8, roughness: 0.35 })
      )
      cone.position.y = -L / 2 + 0.35
      group.add(cone)
      group.add(seg(-L / 2 + 0.55, buttEnd, buttR * 0.85, buttR, mat(buttColor, { map: gripTex })))
    } else if (buttStyle === "small-cone") {
      var cone2 = new THREE.Mesh(
        new THREE.ConeGeometry(buttR * 0.85, 0.55, 32),
        mat(metalColor, { metalness: 0.75, roughness: 0.4 })
      )
      cone2.position.y = -L / 2 + 0.32
      cone2.rotation.x = Math.PI
      group.add(cone2)
      group.add(seg(-L / 2 + 0.5, buttEnd, buttR * 0.85, buttR, mat(buttColor, { map: gripTex })))
    } else if (buttStyle === "poly-metal") {
      var poly = new THREE.Mesh(
        new THREE.CylinderGeometry(buttR * 0.9, buttR * 1.15, 0.55, 6),
        mat(metalColor, { metalness: 0.95, roughness: 0.05 })
      )
      poly.position.y = -L / 2 + 0.32
      group.add(poly)
      group.add(seg(-L / 2 + 0.55, buttEnd, buttR * 0.85, buttR, mat(buttColor, { map: gripTex })))
    } else {
      // 默认圆润杆尾
      group.add(seg(-L / 2, buttEnd, buttR * 0.85, buttR, mat(buttColor, { map: gripTex, roughness: 0.8 })))
    }

    // 金属镶嵌环
    if (!theme.geometry || !theme.geometry.noMetalRing) {
      group.add(seg(buttEnd, ringEnd, buttR * 1.08, buttR * 1.08,
        mat(metalColor, { map: metalTex, metalness: p.metal ? p.metal.metalness : 0.9, roughness: p.metal ? p.metal.roughness : 0.2 })))
    }

    // 握把 grip
    if (pattern === "qingzhutingfeng") {
      // 青竹：竹节凸起
      var gripSegs = 4
      var gh = (gripEnd - ringEnd) / gripSegs
      for (var gi = 0; gi < gripSegs; gi++) {
        var y0 = ringEnd + gi * gh
        var y1 = y0 + gh * 0.82
        var yRing = y0 + gh * 0.82
        group.add(seg(y0, y1, gripR * 0.92, gripR * 0.88, mat(gripColor, { map: gripTex, roughness: 0.7 })))
        group.add(seg(y1, yRing + gh * 0.18, gripR * 1.06, gripR * 1.06, mat("#a0d0a0", { shininess: 60 })))
      }
    } else {
      group.add(seg(ringEnd, gripEnd, gripR * 0.95, gripR * 0.88, mat(gripColor, { map: gripTex, roughness: p.grip ? p.grip.roughness : 0.85 })))
    }

    // 杆身 shaft
    var shaftParams = p.shaft || { roughness: 0.55 }
    if (shaftParams.transparent) shaftParams.map = shaftTex
    var shaftMatParams = { map: shaftTex }
    for (var k in shaftParams) { if (Object.prototype.hasOwnProperty.call(shaftParams, k)) shaftMatParams[k] = shaftParams[k] }
    group.add(seg(gripEnd, shaftEnd, shaftR * 0.9, shaftR * 1.02, mat(shaftColor, shaftMatParams)))

    // 先角 ferrule
    group.add(seg(shaftEnd, ferruleEnd, ferruleR * 0.92, ferruleR, mat("#eeeeee", { shininess: 80 })))

    // 皮头 tip
    group.add(seg(ferruleEnd, L / 2, tipR * 0.88, tipR, mat(tipColor, { roughness: 0.85 })))

    return group
  } catch (e) {
    console.error("[cuePreview3D] buildCue failed for pattern:", opts.pattern, e)
    if (opts.pattern !== "auto") {
      return buildCue({ wood: opts.wood, dark: opts.dark, metal: opts.metal, tip: opts.tip, pattern: "auto" }, quality)
    }
    throw e
  }
  }

  // ---------- 主类 ----------
  function CuePreview3D(canvas) {
    this.canvas = canvas
    this.renderer = null
    this.scene = null
    this.camera = null
    this.cue = null
    this.reflection = null
    this.cuePivot = null
    this.reflectionPivot = null
    this.raf = null
    this.running = false
    this.spin = 0
    this.floatPhase = 0
    this.quality = "high"
    this.theme = { wood: "#d2b48c", dark: "#1a1a1a", metal: "#c9a24b", tip: "#2f7d4f", pattern: "auto" }
    this._onResize = this._onResize.bind(this)
    this._loop = this._loop.bind(this)
  }

  CuePreview3D.prototype.init = function () {
    var THREE = global.THREE
    var self = this
    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas: this.canvas, antialias: true, alpha: true, preserveDrawingBuffer: false
      })
      this.renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 2))
      this.renderer.setClearColor(0x0a1020, 1)
      this.renderer.outputColorSpace = THREE.SRGBColorSpace
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping
      this.renderer.toneMappingExposure = 1.05
      if (useLowQuality(this.renderer)) {
        this.quality = "low"
        this.renderer.toneMapping = THREE.NoToneMapping
      }
    } catch (e) {
      console.error("[cuePreview3D] WebGLRenderer 创建失败", e)
      return
    }

    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100)
    this.camera.position.set(0, 0.3, 7.5)
    this.camera.lookAt(0, 0.2, 0)

    var hemi = new THREE.HemisphereLight(0xaec4e8, 0x070a12, 0.65)
    this.scene.add(hemi)
    // 主光：更暖更强，突出杆身材质高光
    var key = new THREE.DirectionalLight(0xfff4e0, 1.8)
    key.position.set(4, 7, 7)
    this.scene.add(key)
    // 轮廓光：从后下方打，让横置杆身有立体边缘
    var rim = new THREE.DirectionalLight(0xffd080, 0.9)
    rim.position.set(-5, -1, -5)
    this.scene.add(rim)
    var fill = new THREE.DirectionalLight(0xc8ddff, 0.6)
    fill.position.set(0, -3, 6)
    this.scene.add(fill)
    var back = new THREE.DirectionalLight(0x4a6a9a, 0.35)
    back.position.set(0, 5, -6)
    this.scene.add(back)

    this.cue = buildCue(this.theme, this.quality)
    // v1.3.38：球杆横置展示——用 pivot 把沿 Y 轴建模的球杆放平到 X 轴，
    // 旋转动画只绕 pivot 的 X 轴（即横杆长轴）滚动，呈现产品式水平自转。
    this.cue.rotation.z = Math.PI / 2
    this.cuePivot = new THREE.Group()
    this.cuePivot.add(this.cue)
    this.scene.add(this.cuePivot)

    this.reflection = buildCue(this.theme, this.quality)
    this.reflection.rotation.z = Math.PI / 2
    this.reflection.traverse(function (o) {
      if (o.isMesh) {
        o.material = o.material.clone()
        o.material.transparent = true
        o.material.opacity = 0.18
        o.material.color = new THREE.Color(hexToNum(self.theme.dark || "#1a1a1a")).lerp(new THREE.Color(0x000000), 0.45)
      }
    })
    this.reflectionPivot = new THREE.Group()
    this.reflectionPivot.add(this.reflection)
    this.reflectionPivot.position.y = -1.35
    // v1.3.38-fix：横置后 cue 长轴已沿 X，对 pivot 做 scale.y = -0.85 才能正确镜像到地面（ floor.y=-1.35 ），
    // 若对 cue 本身 scale.y 会把它沿长轴压短，导致反射错位、出现“断节”。
    this.reflectionPivot.scale.y = -0.85
    this.scene.add(this.reflectionPivot)

    var floor = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      new THREE.MeshBasicMaterial({ map: makeFloorTexture(), transparent: true, opacity: 0.9, depthWrite: false })
    )
    floor.rotation.x = -Math.PI / 2
    floor.position.y = -1.35
    this.scene.add(floor)

    var ringMat = new THREE.MeshBasicMaterial({ color: 0x5c7fb8, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false })
    var ring = new THREE.Mesh(new THREE.RingGeometry(3.25, 3.35, 96), ringMat)
    ring.position.y = -1.35
    ring.rotation.x = -Math.PI / 2
    this.scene.add(ring)

    var ticks = new THREE.Group()
    for (var i = 0; i < 36; i++) {
      var ang = (i / 36) * Math.PI * 2
      var tickLen = (i % 9 === 0) ? 0.16 : 0.08
      var geo = new THREE.CylinderGeometry(0.012, 0.012, tickLen, 8)
      var m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x7a9fd0, transparent: true, opacity: 0.3 }))
      var r = 3.58
      m.position.set(Math.cos(ang) * r, -1.35, Math.sin(ang) * r)
      m.rotation.z = Math.PI / 2
      m.rotation.y = -ang
      ticks.add(m)
    }
    this.scene.add(ticks)

    this._resize()
    global.addEventListener("resize", this._onResize)
  }

  CuePreview3D.prototype._resize = function () {
    if (!this.renderer) return
    var w = this.canvas.clientWidth || 200
    var h = this.canvas.clientHeight || 140
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  CuePreview3D.prototype._onResize = function () { this._resize() }

  CuePreview3D.prototype.setTheme = function (wood, dark, metal, tip, pattern) {
    if (wood) this.theme.wood = wood
    if (dark) this.theme.dark = dark
    if (metal) this.theme.metal = metal
    if (tip) this.theme.tip = tip
    if (pattern) this.theme.pattern = pattern
    if (this.scene) {
      if (this.cuePivot) this.scene.remove(this.cuePivot)
      if (this.reflectionPivot) this.scene.remove(this.reflectionPivot)
      this.cue = buildCue(this.theme, this.quality)
      this.cue.rotation.z = Math.PI / 2
      this.cuePivot = new THREE.Group()
      this.cuePivot.add(this.cue)
      this.scene.add(this.cuePivot)
      var self = this
      this.reflection = buildCue(this.theme, this.quality)
      this.reflection.rotation.z = Math.PI / 2
      this.reflection.traverse(function (o) {
        if (o.isMesh) {
          o.material = o.material.clone()
          o.material.transparent = true
          o.material.opacity = 0.18
          o.material.color = new THREE.Color(hexToNum(self.theme.dark || "#1a1a1a")).lerp(new THREE.Color(0x000000), 0.45)
        }
      })
      this.reflectionPivot = new THREE.Group()
      this.reflectionPivot.add(this.reflection)
      this.reflectionPivot.position.y = -1.35
      this.reflectionPivot.scale.y = -0.85
      this.scene.add(this.reflectionPivot)
    }
  }

  CuePreview3D.prototype.setAutoRotate = function (b) {
    if (b && !this.running) this.start()
    else if (!b && this.running) this.stop()
  }

  CuePreview3D.prototype.start = function () {
    if (this.running) return
    this.running = true
    this._last = 0
    this.raf = global.requestAnimationFrame(this._loop)
  }

  CuePreview3D.prototype.stop = function () {
    this.running = false
    if (this.raf != null) { global.cancelAnimationFrame(this.raf); this.raf = null }
  }

  CuePreview3D.prototype._loop = function (ts) {
    if (!this.running) return
    if (!this.renderer || !this.scene || !this.camera) return
    var dt = this._last ? (ts - this._last) / 1000 : 0.016
    this._last = ts
    this.spin += dt * 0.45
    this.floatPhase += dt * 1.2
    if (this.cuePivot) {
      this.cuePivot.rotation.x = this.spin
      this.cuePivot.position.y = Math.sin(this.floatPhase) * 0.05
    }
    if (this.reflectionPivot) {
      this.reflectionPivot.rotation.x = this.spin
      this.reflectionPivot.position.y = -1.35 + Math.sin(this.floatPhase) * 0.03
    }
    this.renderer.render(this.scene, this.camera)
    this.raf = global.requestAnimationFrame(this._loop)
  }

  CuePreview3D.prototype.dispose = function () {
    this.stop()
    global.removeEventListener("resize", this._onResize)
    if (this.scene) {
      this.scene.traverse(function (o) {
        if (o.geometry) o.geometry.dispose()
        if (o.material) {
          var mats = Array.isArray(o.material) ? o.material : [o.material]
          mats.forEach(function (m) { if (m.map) m.map.dispose(); m.dispose() })
        }
      })
    }
    if (this.renderer) {
      this.renderer.dispose()
      if (this.renderer.forceContextLoss) this.renderer.forceContextLoss()
    }
    this.renderer = null; this.scene = null; this.camera = null
    this.cue = null; this.reflection = null
    this.cuePivot = null; this.reflectionPivot = null
  }

  global.CuePreview3D = CuePreview3D
})(typeof self !== "undefined" ? self : this)
