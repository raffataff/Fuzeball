from PIL import Image,ImageDraw,ImageFont,ImageFilter
import math,random,os
out='assets/pitches/source/helios_runners';os.makedirs(out,exist_ok=True)
W,H=2048,1160; S=W/120
random.seed(931); im=Image.new('RGB',(W,H));pix=im.load()
for y in range(H):
 for x in range(W):
  n=random.uniform(-2.5,2.5)+2*math.sin(x*.010)*math.cos(y*.013);pix[x,y]=tuple(max(0,int(v+n)) for v in (18,22,23))
d=ImageDraw.Draw(im); ivory='#f9d8a3'; orange='#ff4b0a'; yellow='#ffb82a'
def pt(x,z):return (round((x+60)*S),round((z+34)*S))
def line(coords,fill=ivory,w=.12): d.line([pt(*p) for p in coords],fill=fill,width=max(1,round(w*S)),joint='curve')
def ellipse(cx,cy,rx,ry,fill=None,outline=ivory,w=.13): d.ellipse((*pt(cx-rx,cy-ry),*pt(cx+rx,cy+ry)),fill=fill,outline=outline,width=round(w*S))
# Crisp football markings; inner emblem stays within the center circle.
line([(-58.8,-32.6),(58.8,-32.6),(58.8,32.6),(-58.8,32.6),(-58.8,-32.6)])
line([(0,-32.6),(0,32.6)]);ellipse(0,0,10.5,10.5)
for sx in (-1,1):
 for dep,half in [(19.5,21),(8,11)]:line([(sx*58.8,-half),(sx*(58.8-dep),-half),(sx*(58.8-dep),half),(sx*58.8,half)])
 ellipse(sx*45.3,0,.55,.55,ivory,None)
 # clipped partial arc outside penalty box
 box=(*pt(sx*45.3-10.5,-10.5),*pt(sx*45.3+10.5,10.5))
 d.arc(box,110 if sx<0 else 290,250 if sx<0 else 70,fill=ivory,width=2)
# Orange sun, cut-out black orbital crescent, ivory orbit and spear.
ellipse(0,0,5.4,5.4,orange,None);ellipse(1.3,0,4.35,4.35,'#181c1c',None)
line([(-12.7,-.7),(13.8,.7)],ivory,.11)
d.polygon([pt(-18,-1.0),pt(-3,-.35),pt(-5,-.05)],fill=ivory)
d.polygon([pt(13,.45),pt(18,1.0),pt(5,.33)],fill=ivory)
# Corner racing decals, outside the centre lane.
font='C:/Windows/Fonts/arialbd.ttf'
for sx in (-1,1):
 for sz in (-1,1):
  for j in range(3):
   x=sx*(29+j*2.3); z=sz*27
   d.polygon([pt(x-1,z-1.2),pt(x+.2,z-1.2),pt(x+1,z+1.2),pt(x-.2,z+1.2)],fill=orange)
  for row in range(2):
   for col in range(5):
    if (row+col)%2==0:
     x=sx*(41+col*1.1);z=sz*(26+row*1.1)
     d.polygon([pt(x,z),pt(x+sx*.8,z),pt(x+sx*.8,z+sz*.8),pt(x,z+sz*.8)],fill=ivory)
# Small readable technical labels towards the long edges.
for x in (165,1450):
 d.text((x,80),'HELIOS  /  RUNNERS',font=ImageFont.truetype(font,31),fill='#d3b692')
 d.text((x,111),'ORBITAL RACING  //  09',font=ImageFont.truetype(font,17),fill='#a08971')
 d.text((x,1020),'09   //   SOLAR DIVISION',font=ImageFont.truetype(font,25),fill='#d3b692')
# Sponsor-style orbital roundels and chevrons fill the open panels.
for sx in (-1,1):
 for sz in (-1,1):
  cx,cz=sx*26,sz*18
  ellipse(cx,cz,2.2,2.2,None,orange,.14)
  line([(cx-3.4,cz+.25),(cx+3.4,cz-.25)],ivory,.09)
  d.polygon([pt(cx+sx*4.5,cz-.8),pt(cx+sx*5.1,cz-.8),pt(cx+sx*5.8,cz),pt(cx+sx*5.1,cz+.8),pt(cx+sx*4.5,cz+.8),pt(cx+sx*5.2,cz)],fill=orange)
  d.polygon([pt(cx+sx*6,cz-.8),pt(cx+sx*6.6,cz-.8),pt(cx+sx*7.3,cz),pt(cx+sx*6.6,cz+.8),pt(cx+sx*6,cz+.8),pt(cx+sx*6.7,cz)],fill=ivory)
for x in (300,1170):
 d.text((x,495),'SOLAR',font=ImageFont.truetype(font,27),fill='#a98e6d')
 d.text((x,530),'RACING  //  09',font=ImageFont.truetype(font,18),fill='#8f7a62')
im.save(os.path.join(out,'basecolor.png'));im.save('assets/pitches/helios_runners.jpeg',quality=92)
# Fine PBR finish: dark satin polymer rather than an unlit image.
n=Image.new('RGB',(512,512));nr=n.load();orm=Image.new('RGB',(512,512));mr=orm.load();random.seed(4)
for y in range(512):
 for x in range(512):
  v=random.randrange(-3,4);nr[x,y]=(128+v,128+random.randrange(-3,4),255);mr[x,y]=(255,145+v,12)
n.save(os.path.join(out,'normal.png'));orm.save(os.path.join(out,'orm.png'))
