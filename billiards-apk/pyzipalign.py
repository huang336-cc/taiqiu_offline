#!/usr/bin/env python3
"""
极简 zipalign 替代：对 zip 内每个条目的「数据起始偏移」做 4 字节对齐，
保持各条目原始压缩方法（resources.arsc 为 STORED，其余 DEFLATED）不变。
用于沙箱缺 libc++.so 导致 Android build-tools 的 zipalign 二进制无法运行时的替代。
仅做对齐，不改变内容，签名/权限/arsc 存储方式均保持不变。
"""
import sys, struct, zlib, binascii, zipfile

def align_zip(inp, outp, alignment=4):
    zin = zipfile.ZipFile(inp, 'r')
    items = []
    for info in zin.infolist():
        data = zin.read(info.filename)  # 解压后的原文
        items.append((info.filename, data, info.compress_type,
                      info.date_time, info.external_attr, info.comment or b'',
                      info.create_system))
    zin.close()

    local_parts = []
    central = []
    offset = 0
    for (name, data, method, date_time, ext_attr, comment, csys) in items:
        name_b = name.encode('utf-8')
        if method == 0:
            comp = data
        else:
            # ZIP 的 DEFLATED 使用 raw deflate（无 zlib 头/尾），必须用 wbits=-15
            co = zlib.compressobj(9, zlib.DEFLATED, -15)
            comp = co.compress(data) + co.flush()
        crc = binascii.crc32(data) & 0xffffffff
        comp_size = len(comp)
        uncomp_size = len(data)

        # 对齐：data 起始 = offset + 30 + len(name) + extra_len，需为 alignment 倍数
        base = offset + 30 + len(name_b)
        rem = base % alignment
        if rem == 0:
            extra_len = 0
            extra = b''
        else:
            # extra 字段至少 4 字节（2 字节 id + 2 字节 size）；取使 (base+extra_len)%4==0 的最小值
            extra_len = (alignment - rem) + alignment
            extra = b'\x00' * extra_len
        data_start = offset + 30 + len(name_b) + extra_len
        assert data_start % alignment == 0, (data_start, alignment)

        lh = struct.pack('<IHHHHHIIIHH',
            0x04034b50, 20, 0, method, 0, 0, crc, comp_size, uncomp_size,
            len(name_b), extra_len)
        lh += name_b + extra + comp
        local_parts.append(lh)

        cde = struct.pack('<IHHHHHHIIIHHHHHII',
            0x02014b50, 20, 20, 0, method, 0, 0, crc, comp_size, uncomp_size,
            len(name_b), extra_len, 0, 0, csys, ext_attr & 0xffff, offset)
        cde += name_b + extra + comment
        central.append(cde)
        offset += len(lh)

    with open(outp, 'wb') as out:
        for p in local_parts:
            out.write(p)
        cd_start = offset
        cd_size = 0
        for c in central:
            out.write(c)
            cd_size += len(c)
        eocd = struct.pack('<IHHHHIIH',
            0x06054b50, 0, 0, len(items), len(items), cd_size, cd_start, 0)
        out.write(eocd)

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print("usage: pyzipalign.py <in.apk> <out.apk> [alignment]")
        sys.exit(1)
    al = int(sys.argv[3]) if len(sys.argv) > 3 else 4
    align_zip(sys.argv[1], sys.argv[2], al)
    print("aligned -> %s" % sys.argv[2])
