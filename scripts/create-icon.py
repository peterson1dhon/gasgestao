"""Gera o ícone original do aplicativo. Requer Pillow apenas para regeneração."""
from pathlib import Path
from PIL import Image, ImageDraw
root=Path(__file__).resolve().parent.parent
img=Image.new('RGBA',(1024,1024),(0,0,0,0))
d=ImageDraw.Draw(img)
d.rounded_rectangle((32,32,992,992),radius=224,fill='#153f34')
d.rounded_rectangle((220,220,804,844),radius=168,fill='#d6e99f')
d.rounded_rectangle((384,128,640,244),radius=36,fill='#d6e99f')
d.rounded_rectangle((436,156,588,212),radius=16,fill='#153f34')
# Silhueta de chama desenhada para esta identidade, sem recursos de terceiros.
d.polygon([(532,360),(555,403),(600,450),(648,505),(663,551),(658,590),(636,634),(600,672),(552,698),(500,704),(456,688),(416,654),(391,612),(389,567),(406,530),(432,496),(428,540),(440,568),(464,585),(488,582),(508,560),(516,532),(510,502),(498,470),(502,419)],fill='#153f34')
img=img.resize((256,256),Image.Resampling.LANCZOS)
img.save(root/'assets'/'icon.png')
img.save(root/'assets'/'icon.ico',sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
