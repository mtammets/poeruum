// Export generated artwork to placement sizes and package the campaign assets.
// Does not generate or creatively alter images; preserves original generated PNGs.
import { readFile, writeFile, mkdir, copyFile, cp, stat, access } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const work = path.join(root, 'output/musta-rahni-campaign-pack')
const manifest = JSON.parse(await readFile(path.join(work, 'manifest.json'), 'utf8'))
const packageName = 'Musta-rahni-paevad-kampaaniapakett'
const pack = path.join(work, packageName)
const downloads = path.resolve(process.env.CAMPAIGN_EXPORT_DIR || path.join(homedir(), 'Downloads'))
const publishedPack = path.join(downloads, packageName)
const zipPath = path.join(downloads, packageName + '.zip')
await mkdir(downloads, { recursive: true })
for (const destination of [pack, publishedPack, zipPath]) {
  try { await access(destination); throw new Error('Already exists: ' + destination) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
}
await mkdir(pack, { recursive: true })
await mkdir(path.join(work, 'originals'), { recursive: true })
const records = []
const titles = [
  'Kampaania · uudisvoog', 'Nokkmüts · uudisvoog',
  'Kampaania · Story', 'Nokkmüts · Story',
  'Karussell 1 · rähn', 'Karussell 2 · müts', 'Karussell 3 · pakkumine',
  'Google · lai tootepilt', 'Google · ruudukujuline tootepilt',
]
const groupFor = index => index < 2 ? '01-Uudisvoog' : index < 4 ? '02-Story' : index < 7 ? '03-Karussell' : '04-Google'
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
async function record(relative, title, extra = {}) {
  const bytes = await readFile(path.join(pack, relative))
  const entry = { file: relative, title, bytes: bytes.length, sha256: digest(bytes), ...extra }
  records.push(entry)
  return entry
}
for (const [index, job] of manifest.jobs.entries()) {
  const group = groupFor(index)
  await mkdir(path.join(pack, group), { recursive: true })
  await copyFile(job.sourcePath, path.join(work, 'originals', job.id + '-v' + (job.version || 1) + '.png'))
  const file = group + '/' + job.id + '-' + job.w + 'x' + job.h + '.png'
  execFileSync('sips', ['-z', String(job.h), String(job.w), job.sourcePath, '--out', path.join(pack, file)], { stdio: 'pipe' })
  const png = await readFile(path.join(pack, file))
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20)
  if (width !== job.w || height !== job.h) throw new Error('Wrong image dimensions: ' + file)
  if (index >= 7 && png.length > 5 * 1024 * 1024) throw new Error('Display image exceeds 5 MB')
  await record(file, titles[index], { width, height, type: 'image' })
}
// Preserve a clean copy of the real brand mark as a separate Google Ads asset.
const logoFile = '04-Google/kruk-kruk-logo.png'
execFileSync('sips', ['-s', 'format', 'png', path.join(work, 'kruk-logo.webp'), '--out', path.join(pack, logoFile)], { stdio: 'pipe' })
await record(logoFile, 'Krük-Krüki ametlik logo', { type: 'image', width: 500, height: 500 })

const extras = [
  ['05-Videod/10-youtube-bumper-6s-1920x1080.mp4', path.join(work, '10-youtube-bumper-6s-1920x1080.mp4'), 'YouTube · 6 sekundit', 'video'],
  ['05-Videod/11-reels-15s-1080x1920.mp4', path.join(root, 'output/musta-rahni-reel/musta-rahni-paevad-reels.mp4'), 'Reels · 15 sekundit', 'video'],
  ['05-Videod/12-youtube-15s-1920x1080.mp4', path.join(root, 'output/musta-rahni-youtube/musta-rahni-paevad-youtube-full-hd.mp4'), 'YouTube · 15 sekundit', 'video'],
  ['06-Kaanepildid/facebook-kaanepilt.png', path.join(root, 'public/images/social/musta-rahni-paevad-facebook-cover-v1.png'), 'Facebooki kaanepilt', 'image'],
  ['06-Kaanepildid/reels-kaanepilt.jpg', path.join(downloads, 'Musta-rahni-paevad-Reels-kaas.jpg'), 'Reelsi kaanepilt', 'image'],
]
for (const [file, source, title, type] of extras) {
  await mkdir(path.dirname(path.join(pack, file)), { recursive: true })
  await copyFile(source, path.join(pack, file))
  await record(file, title, { type })
}

const guide = `MUSTA RÄHNI PÄEVAD – KAMPAANIAPAKETT

01-Uudisvoog
Kaks 1080 × 1350 PNG-pilti (4:5): kampaania ja mütsi ostupakkumine.
Kasuta neid eraldi Facebooki või Instagrami uudisvoo reklaamina.

02-Story
Kaks 1080 × 1920 PNG-pilti (9:16): kampaania ja mütsi ostupakkumine.
Lisa Story lingikleebis vabasse alumisse metsaga alasse.
Vali reklaami eelvaates vastav püstfail ja kontrolli teksti paiknemist rakenduse juhtnuppude suhtes.

03-Karussell
Kolm 1080 × 1080 PNG-pilti (1:1). Järjekord:
05 – kampaania rähniga; 06 – müts; 07 – hind ja ostukutse.
Selle loo puhul säilita käsitsi määratud järjekord.

04-Google
Tekstita tootepildid 1200 × 628 ja 1200 × 1200 ning eraldi ametlik logo.
Need on kohanduva displeireklaami pildiressursid. Lisa reklaamikeskkonnas pealkiri, kirjeldus ja päris ostunupp.
Võimalik pealkiri: Musta rähni päevad
Võimalik pikem pealkiri: Viska nokk ette. Krük-Krüki nokkmüts „2rähn” 19,90 €.
Võimalik kirjeldus: Loodusest nokk ees. Leia Krük-Krüki nokkmüts „2rähn”.
Ettevõtte nimi: Krük-Krük
Hind piltidel: 19,90 €. Kontrollitud poe avalikest andmetest 22.10.2026.

05-Videod
6 s YouTube'i bumper: 1920 × 1080, H.264 MP4, 30 fps, AAC stereo.
15 s Reels: 1080 × 1920, H.264 MP4, 30 fps, AAC stereo.
15 s YouTube: 1920 × 1080, H.264 MP4, 30 fps, AAC stereo.
Kõigil rähnihääl ja õrn metsaõhustik. 6 s failis üks rähni häälitsus.

06-Kaanepildid
Varem valminud Facebooki kaanepilt ja Reelsi kaanepilt.

SIHTLEHED
Kampaania üldreklaam: https://kaubamaja.poeruum.ee/
Mütsi ostureklaam ja karussell: https://kruk-kruk.poeruum.ee/toode/nokkmuts/
Ostulingid koos eristavate UTM-parameetritega on failis REKLAAMILINGID.csv.
Pildil olev tekst „Osta nokkmüts” ise ei ole klõpsatav. Määra reklaamile ostunupp ja sihtlink või lisa orgaanilisele Storyle lingikleebis.

Loomine: pildid built-in image_gen abil, olemasoleva kampaania ja toote viidetest.
Videod: olemasolevad kampaania kihid ja kohalik deterministlik animatsioon.
Pakett sisaldab avaldamiseks mõeldud faile; reklaame ei ole kontodele üles laaditud.
`
await writeFile(path.join(pack, 'KASUTAMINE.txt'), guide)
const csv = ['fail;sihtlink']
for (const entry of records.filter(r => !r.file.includes('logo') && !r.file.includes('Kaanepildid'))) {
  const isCampaign = entry.file.includes('kampaania') || entry.type === 'video'
  const target = new URL(isCampaign ? 'https://kaubamaja.poeruum.ee/' : 'https://kruk-kruk.poeruum.ee/toode/nokkmuts/')
  const google = entry.file.includes('Google') || entry.file.includes('youtube')
  target.searchParams.set('utm_source', google ? (entry.type === 'video' ? 'youtube' : 'google') : 'meta')
  target.searchParams.set('utm_medium', entry.type === 'video' && google ? 'paid_video' : google ? 'display' : 'paid_social')
  target.searchParams.set('utm_campaign', 'musta_rahni_paevad')
  target.searchParams.set('utm_content', path.basename(entry.file).replace(/\.[^.]+$/, ''))
  csv.push(entry.file + ';' + target.href)
}
await writeFile(path.join(pack, 'REKLAAMILINGID.csv'), '\ufeff' + csv.join('\n') + '\n')
await writeFile(path.join(pack, 'FAILID.json'), JSON.stringify(records, null, 2) + '\n')
const esc = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;')
const cards = records.filter(r => !r.file.includes('logo')).map(r => {
  const source = esc(r.file)
  const media = r.type === 'video' ? '<video controls preload="metadata" src="' + source + '"></video>' : '<img loading="lazy" src="' + source + '" alt="' + esc(r.title) + '">'
  return '<article>' + media + '<div><strong>' + esc(r.title) + '</strong><p>' + (r.width ? r.width + ' × ' + r.height + ' · ' : '') + (r.bytes / 1024 / 1024).toFixed(1) + ' MB</p><a href="' + source + '" download>Laadi fail alla ↗</a></div></article>'
}).join('\n')
await writeFile(path.join(pack, 'AVA-EELVAADE.html'), '<!doctype html><html lang="et"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Musta rähni päevad – kampaaniafailid</title><style>*{box-sizing:border-box}body{margin:0;background:#f0eadc;color:#531b25;font:16px system-ui,sans-serif}main{max-width:1500px;margin:auto;padding:48px 24px}h1{font-size:clamp(28px,5vw,60px);line-height:1.05;max-width:700px}header p{max-width:650px;line-height:1.6}header a{color:inherit}section{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:24px;margin-top:40px}article{background:#fffaf0;overflow:hidden;border-radius:12px}article img,article video{display:block;width:100%;height:360px;object-fit:contain;background:#e6dece}article div{padding:20px}article p{font-size:14px;opacity:.7}article a{color:inherit}footer{margin-top:40px;font-size:14px}</style><main><header><p>KRÜK-KRÜK · POERUUM</p><h1>MUSTA RÄHNI PÄEVAD</h1><p>Reklaamipildid ja videod kanalite kaupa. Ava pilt või laadi alla originaalfail. <a href="KASUTAMINE.txt">Kasutusjuhis</a> · <a href="REKLAAMILINGID.csv">Reklaamilingid</a></p></header><section>' + cards + '</section><footer>Piltide hind 19,90 € · poeandmed kontrollitud 22.10.2026.</footer></main></html>')
const prompts = await Promise.all(manifest.jobs.map(async job => {
  const initial = await readFile(path.join(root, 'docs/campaigns/image-prompts/social-pack', job.id + '.txt'), 'utf8')
  const revised = job.version === 2 ? '\n\nEDIT V2\n' + await readFile(path.join(root, 'docs/campaigns/image-prompts/social-pack', job.id + '-v2.txt'), 'utf8') : ''
  return '=== ' + job.id + ' ===\n' + initial + revised
}))
await writeFile(path.join(work, 'loomisjuhised.txt'), prompts.join('\n\n'))
await cp(pack, publishedPack, { recursive: true, errorOnExist: true, force: false })
execFileSync('/usr/bin/zip', ['-q', '-r', zipPath, packageName], { cwd: work, stdio: 'pipe' })
execFileSync('/usr/bin/unzip', ['-tq', zipPath], { stdio: 'pipe' })
for (const entry of records) {
  const copied = await readFile(path.join(publishedPack, entry.file))
  if (digest(copied) !== entry.sha256) throw new Error('Copy mismatch: ' + entry.file)
}
console.log(JSON.stringify({ folder: publishedPack, zip: zipPath, files: records.length, zipBytes: (await stat(zipPath)).size, images: records.filter(r => r.type === 'image').length, videos: records.filter(r => r.type === 'video').length }, null, 2))
