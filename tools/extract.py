"""写真から車両・レールパーツを透過PNGに切り出す。"""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

src, out = sys.argv[1], sys.argv[2]
im = Image.open(src).convert("RGB")
a = np.asarray(im).astype(float)
mx, mn = a.max(2), a.min(2)
sat = mx - mn
lum = a.mean(2)
mask = (sat > 38) | (lum < 150)
mask = ndi.binary_closing(mask, iterations=2)
mask = ndi.binary_fill_holes(mask)
mask = ndi.binary_opening(mask, iterations=2)

def crop(name, box, keep=1):
    x0, y0, x1, y1 = box
    m = np.zeros_like(mask)
    m[y0:y1, x0:x1] = mask[y0:y1, x0:x1]
    lab, n = ndi.label(m)
    sizes = ndi.sum(m, lab, range(1, n + 1))
    k = int(np.argmax(sizes)) + 1
    mm = lab == k
    mm = ndi.binary_fill_holes(mm)
    mm = ndi.binary_erosion(mm, iterations=1)
    ys, xs = np.where(mm)
    bx0, bx1, by0, by1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    alpha = ndi.gaussian_filter(mm.astype(float), 0.8)
    rgba = np.dstack([a, alpha * 255]).astype(np.uint8)
    Image.fromarray(rgba[by0:by1, bx0:bx1], "RGBA").save(f"{out}/{name}.png")
    print(name, bx1 - bx0, by1 - by0)

crop("loco", (60, 370, 175, 630))
crop("car_blue", (225, 370, 335, 630))
crop("car_green", (395, 370, 500, 630))
crop("car_red", (560, 370, 700, 630))
crop("rail_long", (55, 730, 160, 1290))
crop("rail_short", (210, 730, 310, 960))
crop("rail_curve", (365, 730, 485, 1000))
