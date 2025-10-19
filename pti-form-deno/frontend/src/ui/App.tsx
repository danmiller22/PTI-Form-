import React, { useMemo, useRef, useState } from 'react'
import '../i18n'
import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import { chunk, sleep, toChicagoISO } from '../utils'

type PhotoItem = { base64: string, bytes: number, w: number, h: number, mime: string, filename: string }

export default function App() {
  const { i18n } = useTranslation()
  const [step, setStep] = useState(0)

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName]   = useState('')
  const [truck, setTruck]         = useState('')
  const [trailer, setTrailer]     = useState('')
  const [comment, setComment]     = useState('')

  const [photos, setPhotos]       = useState<PhotoItem[]>([])
  const [busyCompress, setBusyCompress] = useState(false)

  const [geoAllowed, setGeoAllowed] = useState(false)
  const [loc, setLoc] = useState<{lat?: number, lon?: number, accuracy?: number}>({})

  const [busySend, setBusySend] = useState(false)
  const [sendText, setSendText] = useState('')
  const [sentOk, setSentOk]     = useState(false)
  const [errorText, setErrorText] = useState('')

  const fileInputRef = useRef<HTMLInputElement|null>(null)
  const timeInfo = useMemo(() => toChicagoISO(), [])
  const ru = i18n.language.startsWith('ru')

  const L = {
    title: 'Pre-Trip Inspection',
    firstName: ru ? 'Имя' : 'First name',
    lastName:  ru ? 'Фамилия' : 'Last name',
    truck:     ru ? 'Трак №' : 'Truck #',
    trailer:   ru ? 'Трейлер №' : 'Trailer #',
    comment:   ru ? 'Комментарий / дефекты (опц.)' : 'Comments / defects (optional)',
    useGeo:    ru ? 'Использовать текущую геолокацию' : 'Use current location',
    timeAuto:  ru ? 'Время (Америка/Чикаго)' : 'Time (America/Chicago)',
    next:      ru ? 'Далее' : 'Next',
    back:      ru ? 'Назад' : 'Back',
    submit:    ru ? 'Отправить в Telegram' : 'Send to Telegram',
    submitted: ru ? 'Отправлено!' : 'Sent!',
    photosMin: ru ? 'Добавьте минимум 20 фото' : 'Add at least 20 photos',
    addPhotos: ru ? 'Добавить фото' : 'Add photos',
    gpsOff:    ru ? 'Геолокация не разрешена' : 'Location not allowed',
    sending:   ru ? 'отправка' : 'sending',
  }

  const canNext = () => {
    if (step === 0) return !!firstName && !!lastName && !!truck && !!trailer
    if (step === 1) return photos.length >= 20
    return true
  }

  // ---------- компрессия: пул воркеров ----------
  function compressOnce(file: File, idx: number, quality: number, maxW: number, maxH: number, timeoutMs = 12000): Promise<PhotoItem> {
    return new Promise<PhotoItem>((resolve, reject) => {
      const worker = new Worker(new URL('../worker/compress.ts', import.meta.url), { type: 'module' })
      const timer = setTimeout(() => { worker.terminate(); reject(new Error('timeout')) }, timeoutMs)
      worker.onmessage = (e: MessageEvent) => {
        clearTimeout(timer)
        const { base64, bytes, w, h, mime } = e.data
        worker.terminate()
        resolve({ base64, bytes, w, h, mime, filename: `photo_${Date.now()}_${idx+1}.webp` })
      }
      worker.onerror = () => { clearTimeout(timer); worker.terminate(); reject(new Error('worker error')) }
      worker.postMessage({ file, quality, maxW, maxH })
    })
  }
  async function compressWithRetry(file: File, idx: number): Promise<PhotoItem> {
    const presets = [
      { q: 0.62, w: 1280, h: 1280 },
      { q: 0.55, w: 1280, h: 1280 },
      { q: 0.5,  w: 1024, h: 1024 },
      { q: 0.45, w: 1024, h: 1024 },
    ]
    for (const p of presets) {
      try { return await compressOnce(file, idx, p.q, p.w, p.h) } catch {}
    }
    return await compressOnce(file, idx, 0.4, 960, 960, 8000)
  }
  async function runPool<T>(tasks: (() => Promise<T>)[], concurrency: number, onEach?: (res: T)=>void) {
    return new Promise<void>((resolve) => {
      let i = 0, active = 0
      const kick = () => {
        while (active < concurrency && i < tasks.length) {
          const t = tasks[i++]
          active++
          t().then(r => onEach?.(r)).finally(() => { active--; if (i>=tasks.length && active===0) resolve(); else kick(); })
        }
      }
      kick()
    })
  }
  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return
    setErrorText(''); setSentOk(false); setBusyCompress(true)
    const list = Array.from(files)
    const tasks = list.map((f, idx)=> () => compressWithRetry(f, idx).then(item => setPhotos(p=>[...p,item])))
    await runPool(tasks, 6)
    setBusyCompress(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // ---------- гео ----------
  const requestGeo = () => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (pos)=>{ setGeoAllowed(true); setLoc({lat:pos.coords.latitude, lon:pos.coords.longitude, accuracy:pos.coords.accuracy}) },
      ()=> setGeoAllowed(false),
      { enableHighAccuracy:true, timeout:8000, maximumAge:0 }
    )
  }

  // ---------- отправка ----------
  const submitAll = async () => {
    setBusySend(true); setSentOk(false); setErrorText('')
    try {
      setSendText('summary')
      const r1 = await fetch(import.meta.env.VITE_API_BASE + '/relay/summary', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          driver:{firstName, lastName},
          unit:{truck, trailer},
          comment, time: timeInfo,
          location:{...loc, method: geoAllowed ? 'geolocation':'none'}
        })
      })
      if (!r1.ok) throw new Error(await r1.text())

      const groups = chunk(photos,10)
      for (let i=0;i<groups.length;i++){
        setSendText(`${L.sending} ${i+1}/${groups.length}`)
        const media = groups[i].map(p=>({filename:p.filename, mime:p.mime, data:p.base64}))
        const r = await fetch(import.meta.env.VITE_API_BASE + '/relay/group', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({unit:{truck,trailer}, index:i+1, total:groups.length, media})
        })
        if (!r.ok) throw new Error(await r.text())
        await sleep(1500)
      }
      setSentOk(true)
    } catch(e:any) {
      setErrorText(typeof e === 'string' ? e : (e?.message || 'error'))
    } finally {
      setBusySend(false); setSendText('')
    }
  }

  const Spinner = () => (
    <div className="flex justify-center py-2">
      <div className="relative w-6 h-6">
        <div className="absolute inset-0 rounded-full opacity-30 animate-ping bg-white"></div>
        <div className="absolute inset-0 rounded-full border-2 border-t-transparent animate-spin"
             style={{borderColor:'rgba(255,255,255,0.35)', borderTopColor:'transparent'}} />
      </div>
    </div>
  )

  const checklistEN = [
    'Truck front & both sides',
    'Trailer front & both sides',
    'All wheels (full set)',
    'Tires: tread / damage / pressure caps',
    'Lights, reflectors, turn signals',
    'Undercarriage, air lines, hoses',
    'Documents: registration, insurance, permits',
    'Defects close-ups'
  ]
  const checklistRU = [
    'Тягач: спереди и обе стороны',
    'Прицеп: спереди и обе стороны',
    'Все колёса (полный комплект)',
    'Шины: протектор / повреждения / колпачки',
    'Фары, отражатели, поворотники',
    'Низ, воздух/шланги/соединения',
    'Документы: регистрация, страховка, пермиты',
    'Дефекты крупным планом'
  ]
  const checklist = ru ? checklistRU : checklistEN

  return (
    <div className="min-h-screen p-3"
      style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", Inter, Roboto, system-ui, Segoe UI, Arial, sans-serif' }}
    >
      <div className="max-w-sm mx-auto">
        <header className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-semibold">{L.title}</h1>
          <div className="flex gap-2 items-center">
            <button className="btn glass px-3 py-1" onClick={()=>i18n.changeLanguage('ru')}>RU</button>
            <button className="btn glass px-3 py-1" onClick={()=>i18n.changeLanguage('en')}>EN</button>
          </div>
        </header>

        <motion.div className="glass p-4">
          {step===0 && (
            <div className="flex flex-col gap-3">
              <input className="glass p-3 w-full h-12 text-base" placeholder={L.firstName} value={firstName} onChange={e=>setFirstName(e.target.value)} />
              <input className="glass p-3 w-full h-12 text-base" placeholder={L.lastName} value={lastName} onChange={e=>setLastName(e.target.value)} />
              <input className="glass p-3 w-full h-12 text-base" placeholder={L.truck} value={truck} onChange={e=>setTruck(e.target.value)} />
              <input className="glass p-3 w-full h-12 text-base" placeholder={L.trailer} value={trailer} onChange={e=>setTrailer(e.target.value)} />
              <textarea className="glass p-3 w-full text-base min-h-[84px]" placeholder={L.comment} value={comment} onChange={e=>setComment(e.target.value)} />
              <div className="text-sm opacity-80">
                {L.timeAuto}: <span className="font-mono">{timeInfo.human}</span>
              </div>
              <button className={`btn h-12 ${geoAllowed ? 'bg-green-600 text-white' : 'glass'}`} onClick={requestGeo}>
                {L.useGeo}
              </button>
              <div className="flex justify-end">
                <button className="btn-primary h-12 px-5" disabled={!canNext() || busySend} onClick={()=>setStep(1)}>{L.next}</button>
              </div>
            </div>
          )}

          {step===1 && (
            <div className="flex flex-col gap-3">
              <div className="text-sm">{L.photosMin}: <b>{photos.length}</b></div>

              {/* чек-лист */}
              <div className="glass p-3 text-sm leading-tight">
                <div className="opacity-80 mb-1">{ru ? 'Сфотографируйте обязательно:' : 'Please capture:'}</div>
                <ul className="list-disc pl-5 space-y-1">
                  {checklist.map((it, i)=>(<li key={i}>{it}</li>))}
                </ul>
              </div>

              <label className="btn-primary w-full h-12 flex items-center justify-center cursor-pointer">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  multiple
                  className="hidden"
                  onChange={e=>handleFiles(e.target.files)}
                />
                {L.addPhotos}
              </label>

              {busyCompress && <Spinner />}

              <div className="flex justify-between mt-2">
                <button className="btn glass h-12 px-5" onClick={()=>setStep(0)}>{L.back}</button>
                <button className="btn-primary h-12 px-5" disabled={!canNext() || busySend} onClick={()=>setStep(2)}>{L.next}</button>
              </div>
            </div>
          )}

          {step===2 && (
            <div className="flex flex-col gap-3">
              <div className="text-sm opacity-80">
                {firstName} {lastName} • {truck}/{trailer} • {timeInfo.human}
              </div>
              <div className="text-sm">{photos.length} {ru ? 'из' : 'of'} 20+</div>
              <div className="text-xs opacity-70">
                {geoAllowed && loc.lat && loc.lon
                  ? `GPS: ${loc.lat?.toFixed(5)}, ${loc.lon?.toFixed(5)} (±${Math.round(loc.accuracy||0)}m)`
                  : L.gpsOff}
              </div>

              <div className="flex justify-between mt-2">
                <button className="btn glass h-12 px-5" onClick={()=>setStep(1)}>{L.back}</button>
                <button
                  className={`h-12 px-5 rounded-xl transition ${sentOk ? 'bg-green-600 text-white' : 'btn-primary'}`}
                  disabled={busySend || photos.length<20}
                  onClick={submitAll}
                >
                  {sentOk ? L.submitted : L.submit}
                </button>
              </div>

              {(busySend || sendText) && <Spinner />}
            </div>
          )}

          {errorText && <div className="mt-3 text-xs text-red-400">{errorText}</div>}
        </motion.div>
      </div>
    </div>
  )
}
