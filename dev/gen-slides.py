#!/usr/bin/env python3
"""A presentation for the rig (dev/rig.sh slides): N slides, each with its number in the title, as LibreOffice's
flat ODP — the rig has LibreOffice make a .pptx of it.   gen-slides.py OUT.fodp [N]"""
import sys
out, n = sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 5
page = lambda i: (f'<draw:page draw:name="S{i}" draw:master-page-name="Default">'
    f'<draw:frame svg:x="2cm" svg:y="2cm" svg:width="24cm" svg:height="3cm"><draw:text-box><text:p>Slide {i} of the deck</text:p></draw:text-box></draw:frame>'
    f'<draw:frame svg:x="2cm" svg:y="6cm" svg:width="24cm" svg:height="8cm"><draw:text-box>'
    + "".join(f"<text:p>Point {j} of slide {i}.</text:p>" for j in range(1, 5)) +
    '</draw:text-box></draw:frame><draw:custom-shape svg:x="20cm" svg:y="14cm" svg:width="5cm" svg:height="3cm"><draw:enhanced-geometry draw:type="ellipse"/></draw:custom-shape></draw:page>')
open(out, "w").write('<?xml version="1.0" encoding="UTF-8"?>\n<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" '
    'xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" '
    'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" '
    'office:version="1.2" office:mimetype="application/vnd.oasis.opendocument.presentation">'
    '<office:master-styles><style:master-page style:name="Default"/></office:master-styles><office:body><office:presentation>'
    + "".join(page(i) for i in range(1, n + 1)) + '</office:presentation></office:body></office:document>')
