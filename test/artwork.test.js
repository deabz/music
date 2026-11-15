const {test}=require('node:test');const assert=require('node:assert/strict');
const {safeCoverUrl,publicNowPlaying}=require('../src/public-artwork');
const {demoCover}=require('../src/demo-cover');
test('cover allowlist accepts only exact HTTPS image hosts, no credentials or custom ports',()=>{
 for(const host of ['i.ytimg.com','img.youtube.com','i.scdn.co'])assert.ok(safeCoverUrl('https://'+host+'/image/cover.jpg'));
 for(const url of ['http://i.ytimg.com/a.jpg','https://i.ytimg.com.evil.test/a.jpg','https://evil.test/i.ytimg.com/a.jpg','https://user:pass@i.ytimg.com/a.jpg','https://i.ytimg.com:444/a.jpg','data:image/png;base64,AAA','javascript:alert(1)','file:///a.jpg','/cover.jpg'])assert.equal(safeCoverUrl(url),'');
 assert.equal(safeCoverUrl('https://i.ytimg.com/vi/example/mqdefault.jpg'),'https://i.ytimg.com/vi/example/hqdefault.jpg');
 assert.equal(safeCoverUrl('https://i.ytimg.com/vi/example/sddefault.jpg'),'https://i.ytimg.com/vi/example/sddefault.jpg');
});
test('public artwork snapshot includes only display metadata and excludes every private field',()=>{
 const source={ready:true,serverCount:3,track:{title:'Mira - Afterglow (Official Video)',artist:'7clouds',thumbnail:'https://i.ytimg.com/vi/example/hqdefault.jpg',durationSeconds:180,positionSeconds:30,status:'paused',server:'PRIVATE_SERVER',channel:'PRIVATE_CHANNEL',requestedBy:'PRIVATE_USER',url:'PRIVATE_STREAM',token:'PRIVATE_TOKEN'}};
 const data=publicNowPlaying(source);
 assert.equal(data.track.title,'Afterglow');assert.equal(data.track.artist,'Mira');assert.equal(data.track.status,'paused');assert.ok(data.track.thumbnail);
 assert.equal(JSON.stringify(data).includes('PRIVATE_'),false);assert.deepEqual(Object.keys(data.track).sort(),['title','artist','thumbnail','durationSeconds','positionSeconds','status','playbackRate'].sort());
 source.track.thumbnail='https://evil.test/image.jpg';assert.equal(publicNowPlaying(source).track.thumbnail,null);
 assert.deepEqual(publicNowPlaying({...source,ready:false}),{status:'offline',track:null});
});
test('demo cover seeds are deterministic, distinct, self-contained, and change with the page variant',()=>{
 const titles=['Peach Hour','Soft Signal','After the Rain'];const images=titles.map(t=>demoCover(t,4));assert.equal(new Set(images).size,3);assert.equal(images[0],demoCover(titles[0],4));assert.notEqual(images[0],demoCover(titles[0],5));
 for(const src of images){assert.ok(src.startsWith('data:image/svg+xml;'));const svg=decodeURIComponent(src.split(',').slice(1).join(','));assert.ok(svg.includes('NYX / FICTIONAL SESSIONS'));assert.ok(!/<image|<script|href=/.test(svg));}
 assert.ok(!decodeURIComponent(demoCover('<script>bad & text</script>',1)).includes('<script>'));
 assert.doesNotThrow(()=>demoCover('A'.repeat(59)+'😀',1));assert.doesNotThrow(()=>demoCover('\ud800',1));
});
