#!/usr/bin/env python3
"""
v1.3.73：给二进制 AndroidManifest.xml（AXML）注入
        android:usesCleartextTraffic="true"

为什么需要这个脚本
------------------
局域网对战用的是明文 ws://（主机连 ws://127.0.0.1:24816，客机连
ws://<对方IP>:24816），而 targetSdkVersion 已提到 35 —— Android 9（API 28）
起 usesCleartextTraffic 默认为 false，WebView 对 target >= 26 的应用**遵循**
该属性，明文 WebSocket 会被直接拒绝（ERR_CLEARTEXT_NOT_PERMITTED）。

但本机 SDK 的 platforms/android-34/android.jar 实为 2011 年的旧版（仅 3133
个类，连 NetworkSecurityPolicy 都没有），资源表里没有这个属性定义，aapt2
link 会直接报 "attribute android:usesCleartextTraffic not found" 拒绝构建。

真机系统读的是 APK 里的**二进制** manifest，只要属性名与资源 ID 写对就能
生效，与构建期用的 android.jar 无关。所以这里绕开 aapt2：构建完 base.apk
后再直接改二进制 manifest。

属性 ID：android:usesCleartextTraffic = 0x010104eb（framework attr，API 23）。

实现说明
--------
AXML 里属性名排在 string pool 的**前部**，并与 ResourceMap 一一对应
（ResXMLTree 靠 mResIds[nameIndex] 把属性名索引翻译成资源 ID）。因此插入
新属性名时必须：
  1. 把 "usesCleartextTraffic" 插到 string pool 的 index = len(resourceMap)
     处（属性名区末尾），不能追加到 pool 末尾；
  2. 在 ResourceMap 同一位置插入 0x010104eb；
  3. 把 pool 中 index >= 该位置的全部引用（元素名、属性值、命名空间）+1；
  4. 在 <application> 的 StartElement 属性区追加一条属性。
这里采用"整体重建"的方式序列化，避免手算偏移量出错。
"""
import struct
import sys

TYPE_XML = 0x0003
TYPE_STRING_POOL = 0x0001
TYPE_RES_MAP = 0x0180
TYPE_START_NS = 0x0100
TYPE_END_NS = 0x0101
TYPE_START_EL = 0x0102
TYPE_END_EL = 0x0103

ATTR_USES_CLEARTEXT_TRAFFIC = 0x010104EB
NEW_ATTR_NAME = "usesCleartextTraffic"
ANDROID_NS = "http://schemas.android.com/apk/res/android"
NO_REF = 0xFFFFFFFF
TYPE_INT_BOOLEAN = 0x12
TYPE_STRING = 0x03


def u32(b, off):
    return struct.unpack_from("<I", b, off)[0]


def u16(b, off):
    return struct.unpack_from("<H", b, off)[0]


def read_chunk(b, off):
    t, h, s = struct.unpack_from("<HHI", b, off)
    return {"off": off, "type": t, "header": h, "size": s, "data": b[off : off + s]}


def parse_string_pool(chunk):
    """返回 (flags, [字符串...])"""
    d = chunk["data"]
    count, styles, flags, str_start, _style_start = struct.unpack_from("<IIIII", d, 8)
    offs = struct.unpack_from("<%dI" % count, d, 28)
    utf8 = bool(flags & 0x100)
    out = []
    for o in offs:
        base = str_start + o
        if utf8:
            p = base
            n16 = d[p]
            p += 1
            if n16 & 0x80:
                n16 = ((n16 & 0x7F) << 8) | d[p]
                p += 1
            n8 = d[p]
            p += 1
            if n8 & 0x80:
                n8 = ((n8 & 0x7F) << 8) | d[p]
                p += 1
            out.append(d[p : p + n8].decode("utf-8"))
        else:
            n = struct.unpack_from("<H", d, base)[0]
            out.append(d[base + 2 : base + 2 + n * 2].decode("utf-16-le"))
    return flags, out


def encode_string_pool_utf16(strings):
    """按 UTF-16（flags=0）重建 string pool chunk"""
    count = len(strings)
    header = 28
    str_start = header + 4 * count  # styleCount = 0
    offsets = []
    blob = bytearray()
    for s in strings:
        offsets.append(len(blob))
        enc = s.encode("utf-16-le")
        blob += struct.pack("<H", len(s))
        blob += enc
        blob += b"\x00\x00"
    # 字符串数据区按 4 字节对齐（AXML 惯例）
    while len(blob) % 4 != 0:
        blob += b"\x00"
    size = str_start + len(blob)
    out = bytearray()
    out += struct.pack("<HHI", TYPE_STRING_POOL, header, size)
    out += struct.pack("<IIIII", count, 0, 0, str_start, 0)
    for o in offsets:
        out += struct.pack("<I", o)
    out += blob
    return bytes(out)


def encode_res_map(ids):
    header = 8
    size = header + 4 * len(ids)
    out = bytearray()
    out += struct.pack("<HHI", TYPE_RES_MAP, header, size)
    for i in ids:
        out += struct.pack("<I", i)
    return bytes(out)


def shift_refs(buf, chunk_type, header_size, threshold):
    """把 chunk 内的字符串池引用（>= threshold 的）全部 +1。

    注意 ResXMLTree 里各字段的偏移是**相对 chunk 起始**的固定值，与
    headerSize 无关：lineNumber=8, comment=12, ns/prefix=16, name/uri=20。
    只有属性区是相对 header 结束处（headerSize + attributeStart）。
    （START_NAMESPACE / END_NAMESPACE 的 headerSize 是 24，其余 node 是 16。）
    """
    if chunk_type in (TYPE_START_NS, TYPE_END_NS):
        for off in (16, 20):  # prefix, uri
            v = u32(buf, off)
            if v != NO_REF and v >= threshold:
                struct.pack_into("<I", buf, off, v + 1)
    elif chunk_type == TYPE_START_EL:
        for off in (16, 20):  # ns, name
            v = u32(buf, off)
            if v != NO_REF and v >= threshold:
                struct.pack_into("<I", buf, off, v + 1)
        attr_start = u16(buf, 24)
        attr_size = u16(buf, 26)
        attr_count = u16(buf, 28)
        for i in range(attr_count):
            ao = header_size + attr_start + i * attr_size
            for delta in (0, 4, 8):  # ns, name, rawValue
                v = u32(buf, ao + delta)
                if v != NO_REF and v >= threshold:
                    struct.pack_into("<I", buf, ao + delta, v + 1)
            # 属性值为字符串时 typedValue.data 也是一个池索引，必须一起平移。
            # 漏了它会出现「主值错位、Raw 值正确」的怪象（aapt2 dump 里表现为
            # versionName=".MainActivity" (Raw: "1.3.72")）。
            if buf[ao + 15] == TYPE_STRING:
                v = u32(buf, ao + 16)
                if v != NO_REF and v >= threshold:
                    struct.pack_into("<I", buf, ao + 16, v + 1)
    elif chunk_type == TYPE_END_EL:
        for off in (16, 20):  # ns, name
            v = u32(buf, off)
            if v != NO_REF and v >= threshold:
                struct.pack_into("<I", buf, off, v + 1)


def append_application_attr(chunk_bytes, ns_idx, name_idx):
    """在 <application> StartElement 的属性区末尾追加一条 boolean 属性"""
    b = bytearray(chunk_bytes)
    header = u16(b, 2)
    attr_start = u16(b, 24)
    attr_size = u16(b, 26)
    attr_count = u16(b, 28)
    if attr_size != 20:
        raise RuntimeError(f"非预期属性结构大小 {attr_size}")
    insert_at = header + attr_start + attr_count * attr_size
    attr = struct.pack(
        "<IIIHBBI",  # ns, name, rawValue, typedValue{size,res0,dataType,data}
        ns_idx,
        name_idx,
        NO_REF,  # rawValue：无原始字符串值
        8,       # typedValue.size
        0,       # res0
        TYPE_INT_BOOLEAN,
        0xFFFFFFFF,  # true
    )
    b[insert_at:insert_at] = attr
    struct.pack_into("<H", b, 28, attr_count + 1)
    struct.pack_into("<I", b, 4, len(b))
    return bytes(b)


def patch(axml: bytes) -> bytes:
    if u16(axml, 0) != TYPE_XML:
        raise RuntimeError("不是 AXML 文件")
    xml_header = u16(axml, 2)
    total = u32(axml, 4)

    chunks = []
    off = xml_header
    while off < total:
        c = read_chunk(axml, off)
        chunks.append(c)
        off += c["size"]

    pool_chunk = next(c for c in chunks if c["type"] == TYPE_STRING_POOL)
    map_chunk = next(c for c in chunks if c["type"] == TYPE_RES_MAP)
    _flags, strings = parse_string_pool(pool_chunk)
    ids = list(struct.unpack_from("<%dI" % ((map_chunk["size"] - map_chunk["header"]) // 4),
                                  map_chunk["data"], map_chunk["header"]))

    # 属性名区长度 = ResourceMap 条目数（属性名排在 pool 前部，与 map 一一对应）
    n = len(ids)
    if NEW_ATTR_NAME in strings:
        print(f"  已存在 {NEW_ATTR_NAME}，跳过注入")
        return axml
    if n > len(strings):
        raise RuntimeError("ResourceMap 条目数多于字符串池条目数，结构异常")

    new_strings = strings[:n] + [NEW_ATTR_NAME] + strings[n:]
    new_ids = ids[:n] + [ATTR_USES_CLEARTEXT_TRAFFIC] + ids[n:]

    out = bytearray()
    out += struct.pack("<HHI", TYPE_XML, xml_header, 8)  # size 最后回填
    out += encode_string_pool_utf16(new_strings)
    out += encode_res_map(new_ids)

    android_ns_idx = strings.index(ANDROID_NS)
    if android_ns_idx >= n:
        android_ns_idx += 1

    for c in chunks:
        if c["type"] in (TYPE_STRING_POOL, TYPE_RES_MAP):
            continue
        buf = bytearray(c["data"])
        shift_refs(buf, c["type"], c["header"], n)
        out += buf

    result = bytearray(out)
    struct.pack_into("<I", result, 4, len(result))

    # 重新扫描产物，定位 <application> 的 StartElement 并追加属性
    pos = xml_header
    while pos < len(result):
        t = u16(result, pos)
        h = u16(result, pos + 2)
        s = u32(result, pos + 4)
        if t == TYPE_START_EL:
            # 元素名在相对 chunk 起始的 +20 处（与 headerSize 无关）
            name_i = u32(result, pos + 20)
            if 0 <= name_i < len(new_strings) and new_strings[name_i] == "application":
                chunk_bytes = bytes(result[pos : pos + s])
                patched = append_application_attr(chunk_bytes, android_ns_idx, n)
                result[pos : pos + s] = patched
                struct.pack_into("<I", result, 4, len(result))
                return bytes(result)
        pos += s

    raise RuntimeError("manifest 里找不到 <application> 元素")


def main():
    if len(sys.argv) != 2:
        print("用法：patch_manifest.py <AndroidManifest.xml|xxx.apk>")
        return 1
    path = sys.argv[1]
    if path.lower().endswith(".apk"):
        import zipfile

        zin = zipfile.ZipFile(path)
        data = zin.read("AndroidManifest.xml")
        new = patch(data)
        import shutil
        import os

        tmp = path + ".tmp"
        zout = zipfile.ZipFile(tmp, "w")
        for info in zin.infolist():
            content = new if info.filename == "AndroidManifest.xml" else zin.read(info.filename)
            zout.writestr(info, content)
        zin.close()
        zout.close()
        shutil.move(tmp, path)
    else:
        with open(path, "rb") as f:
            data = f.read()
        new = patch(data)
        with open(path, "wb") as f:
            f.write(new)
    print(f"  已注入 {NEW_ATTR_NAME}（{len(new)} 字节，原 {len(data)} 字节）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
