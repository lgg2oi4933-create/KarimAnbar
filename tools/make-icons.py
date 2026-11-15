# تولید آیکون‌های PNG بدون وابستگی (فقط zlib)
import zlib, struct, sys

def png(path, size, rounded, inset):
    S = 2  # supersample
    bg = (31, 111, 139)
    def inside_round(x, y, n, r):
        if x < r and y < r: return (x-r)**2 + (y-r)**2 <= r*r
        if x >= n-r and y < r: return (x-(n-r))**2 + (y-r)**2 <= r*r
        if x < r and y >= n-r: return (x-r)**2 + (y-(n-r))**2 <= r*r
        if x >= n-r and y >= n-r: return (x-(n-r))**2 + (y-(n-r))**2 <= r*r
        return True
    def in_poly(px, py, pts):
        c = False
        j = len(pts)-1
        for i in range(len(pts)):
            xi, yi = pts[i]; xj, yj = pts[j]
            if (yi > py) != (yj > py) and px < (xj-xi)*(py-yi)/(yj-yi)+xi: c = not c
            j = i
        return c
    k = 1.0 - 2*inset
    def m(v): return inset + v*k
    tray = [(m(.14), m(.30)), (m(.86), m(.30)), (m(.74), m(.62)), (m(.26), m(.62))]
    inner = [(m(.22), m(.36)), (m(.78), m(.36)), (m(.70), m(.56)), (m(.30), m(.56))]
    bars = [(m(.20), m(.68), m(.80), m(.73), (255,255,255)), (m(.20), m(.78), m(.80), m(.83), (190,220,230))]
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            acc = [0,0,0,0]
            for sy in range(S):
                for sx in range(S):
                    fx = (x + (sx+.5)/S) / size
                    fy = (y + (sy+.5)/S) / size
                    px, py = x*S+sx, y*S+sy
                    if rounded and not inside_round(px, py, size*S, int(size*S*0.22)):
                        continue
                    col = bg
                    if in_poly(fx, fy, tray) and not in_poly(fx, fy, inner): col = (255,255,255)
                    elif in_poly(fx, fy, inner): col = (45, 140, 168)
                    for (x0,y0,x1,y1,c) in bars:
                        if x0 <= fx <= x1 and y0 <= fy <= y1: col = c
                    acc[0]+=col[0]; acc[1]+=col[1]; acc[2]+=col[2]; acc[3]+=255
            n = S*S
            row += bytes([acc[0]//n, acc[1]//n, acc[2]//n, acc[3]//n])
        rows.append(bytes(row))
    raw = b''.join(rows)
    def chunk(t, d):
        c = struct.pack('>I', len(d)) + t + d
        return c + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    open(path, 'wb').write(data)

png('icons/icon-192.png', 192, True, 0.0)
png('icons/icon-512.png', 512, True, 0.0)
png('icons/icon-maskable-512.png', 512, False, 0.16)
print('ok')
