#!/usr/bin/env python3
"""A small PDF for the tests (dev/rig.sh pdf): pages of text with an outline and a link
inside it. dev/gen-pdf.py OUT.pdf [PAGES]"""
import sys
import cairo

out, pages = sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 5
W, H = 595, 842
surface = cairo.PDFSurface(out, W, H)
c = cairo.Context(surface)
words = "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua".split()
for n in range(1, pages + 1):
    c.select_font_face("DejaVu Sans", cairo.FONT_SLANT_NORMAL, cairo.FONT_WEIGHT_BOLD)
    c.set_font_size(22)
    c.move_to(72, 96)
    c.tag_begin(cairo.TAG_DEST, f"name='ch{n}'")
    c.show_text(f"Chapter {n}")
    c.tag_end(cairo.TAG_DEST)
    surface.add_outline(cairo.PDF_OUTLINE_ROOT, f"Chapter {n}", f"dest='ch{n}'", 0)
    c.select_font_face("DejaVu Sans", cairo.FONT_SLANT_NORMAL, cairo.FONT_WEIGHT_NORMAL)
    c.set_font_size(12)
    for i in range(24):
        c.move_to(72, 140 + i * 22)
        c.show_text(f"Line {i + 1} of page {n}: " + " ".join(words[(i + k) % len(words)] for k in range(8)) + ".")
    if n == 1:
        c.move_to(72, 720)
        c.tag_begin(cairo.TAG_LINK, "dest='ch3'")
        c.set_source_rgb(0, 0.3, 0.8)
        c.show_text("See chapter 3")
        c.tag_end(cairo.TAG_LINK)
        c.set_source_rgb(0, 0, 0)
    c.show_page()
surface.finish()
