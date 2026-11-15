from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
import math
root=Path('web')
def icon(size,tile=False):
 scale=4;n=size*scale;im=Image.new('RGBA',(n,n),(0,0,0,0));d=ImageDraw.Draw(im)
 if tile:d.rounded_rectangle((0,0,n,n),radius=n*.22,fill='#101016')
 cx=cy=n/2;r=n*.34;inner=n*.04
 for k in range(8):
  a=k*math.pi/4;d.line((cx+math.cos(a)*inner,cy+math.sin(a)*inner,cx+math.cos(a)*r,cy+math.sin(a)*r),fill='#aa7ef0' if not tile else '#c8a9ff',width=max(2,round(n*.058)))
 return im.resize((size,size),Image.Resampling.LANCZOS)
for n in [16,32]:icon(n).save(root/f'favicon-{n}x{n}.png')
icon(64).save(root/'favicon.ico',sizes=[(16,16),(32,32),(48,48)])
icon(180,True).save(root/'apple-touch-icon.png')
for n in [192,512]:icon(n).save(root/f'icon-{n}.png')
root.joinpath('favicon.svg').write_text('''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><style>path{stroke:#7950b8}@media(prefers-color-scheme:dark){path{stroke:#c8a9ff}}</style><path d="M16 4v24M4 16h24M7.5 7.5l17 17M7.5 24.5l17-17" fill="none" stroke-width="2" stroke-linecap="round"/></svg>''',encoding='utf-8')
fontpath='C:/Windows/Fonts/seguisb.ttf';regular='C:/Windows/Fonts/segoeui.ttf'
labels={'home':('Good music.','Good company.'),'commands':('A command','away.'),'changelog':('A little','better.'),'status':('In the','loop.'),'dashboard':('Your listening','room.'),'404':('A little','lost?')}
for key,(line1,line2) in labels.items():
 im=Image.new('RGB',(1200,630),'#101016');d=ImageDraw.Draw(im)
 for y in range(15,630,24):
  for x in range(15,1200,24):d.ellipse((x,y,x+1,y+1),fill='#30263e')
 im.paste(icon(48,True),(78,66),icon(48,True));d.text((140,64),'nyx.',font=ImageFont.truetype(fontpath,36),fill='#f6f1ee')
 d.text((78,210),line1,font=ImageFont.truetype(fontpath,82),fill='#f6f1ee')
 d.text((78,305),line2,font=ImageFont.truetype(fontpath,82),fill='#c8a9ff')
 d.text((82,510),'YOUR DISCORD, IN RHYTHM  /  GOOD COMPANY STARTS HERE',font=ImageFont.truetype(regular,17),fill='#e7a5ad')
 d.line((80,475,1115,475),fill='#4c3a52',width=1);im.save(root/f'og-{key}.png')
