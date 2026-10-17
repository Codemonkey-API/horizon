import { useEffect, useState } from 'react'
import './App.css'

type Wallpaper = {
  id: string
  name: string
  filename: string
  category: string
  description: string
  colors: string
  width: number | null
  height: number | null
  url: string
}

type Display = {
  name: string
  x: number
  y: number
  width: number
  height: number
}

type WallpaperApiItem = {
  id: string
  path: string
  name: string
  width: number | null
  height: number | null
  url: string
}

function displayName(filename: string): string {
  if (filename.includes("starship")) return "Galaxy-class Starship"
  if (filename.includes("studio-ghibli")) return "Studio Ghibli"
  if (filename.includes("halo-2")) return "Halo 2"
  if (filename.includes("donkey-kong")) return "Donkey Kong Bananza"
  if (filename.includes("koenigsegg")) return "Koenigsegg Jesko"

  return filename.replace(/\\.[^.]+$/, "").replace(/[-_]+/g, " ")
}

function wallpaperCategory(filename: string): string {
  if (filename.includes("starship")) return "SCI-FI"
  if (filename.includes("studio-ghibli")) return "ANIMATION"
  if (filename.includes("halo")) return "GAMING"
  if (filename.includes("donkey-kong")) return "GAMING"
  if (filename.includes("koenigsegg")) return "AUTOMOTIVE"
  return "WALLPAPER"
}

function wallpaperDescription(filename: string): string {
  if (filename.includes("starship")) return "A starship among the stars"
  if (filename.includes("studio-ghibli")) return "A world drawn with imagination"
  if (filename.includes("halo")) return "A legendary sci-fi battlefield"
  if (filename.includes("donkey-kong")) return "An adventurous gaming landscape"
  if (filename.includes("koenigsegg")) return "Precision engineering at full stretch"
  return "From your local wallpaper collection"
}

const accentOptions = [
  { id: 'blue', name: 'Horizon Blue', color: '#579BFF' },
  { id: 'violet', name: 'Violet', color: '#A78BFA' },
  { id: 'mint', name: 'Mint', color: '#5EEAD4' },
  { id: 'rose', name: 'Rose', color: '#FB7185' },
  { id: 'amber', name: 'Amber', color: '#FBBF24' },
] as const

function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  if (hour < 21) return 'Good evening'
  return 'Good night'
}

function App() {
  const [theme, setTheme] = useState<'system' | 'dark' | 'light'>('system')
  const [accentCollapsed, setAccentCollapsed] = useState<boolean>(() => {
    return window.localStorage.getItem('horizon-accent-collapsed') !== 'false'
  })
  const [accent, setAccent] = useState<string>(() => {
    const saved = window.localStorage.getItem('horizon-accent')
    return accentOptions.some((option) => option.id === saved)
      ? saved!
      : 'blue'
  })
  const [systemDark, setSystemDark] = useState(true)
  const [wallpapers, setWallpapers] = useState<Wallpaper[]>([])
  const [wallpaperFolders, setWallpaperFolders] = useState<string[]>([])
  const [rotationFolders, setRotationFolders] = useState<string[]>([])
  const [rotationFolder, setRotationFolder] = useState('')
  const [folderPath, setFolderPath] = useState('')
  const [folderMessage, setFolderMessage] = useState('')
  const [folderBusy, setFolderBusy] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [displays, setDisplays] = useState<Display[]>([])
  const [serviceStatus, setServiceStatus] = useState('Checking…')
  const [libraryError, setLibraryError] = useState('')
  const [selected, setSelected] = useState('')
  const [applyState, setApplyState] = useState<'idle' | 'applying' | 'success' | 'error'>('idle')
  const [applyMessage, setApplyMessage] = useState('')
  const [interval, setInterval] = useState(15)
  const [intervalDraft, setIntervalDraft] = useState(15)
  const [rotationPaused, setRotationPaused] = useState(false)
  const [rotationBusy, setRotationBusy] = useState(false)
  const [rotationMessage, setRotationMessage] = useState('')
  const [activeNav, setActiveNav] = useState('Overview')
  const [greeting, setGreeting] = useState(getGreeting)

  useEffect(() => {
    const updateGreeting = () => setGreeting(getGreeting())
    updateGreeting()
    const timer = window.setInterval(updateGreeting, 60_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const update = () => setSystemDark(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadLiveData() {
      try {
        const response = await fetch('/api/wallpapers')
        if (!response.ok) throw new Error(`Wallpaper API returned ${response.status}`)
        const data = await response.json() as { wallpapers: WallpaperApiItem[] }

        const items: Wallpaper[] = data.wallpapers.map((item) => ({
          id: item.path,
          filename: item.path,
          name: displayName(item.name),
          category: wallpaperCategory(item.name),
          description: wallpaperDescription(item.name),
          colors: 'space',
          width: item.width,
          height: item.height,
          url: item.url,
        }))

        if (!cancelled) {
          setWallpapers(items)
          setSelected((current) =>
            items.some((item) => item.id === current) ? current : (items[0]?.id ?? ''),
          )
          setLibraryError(items.length ? '' : 'No supported wallpapers found in your collection.')
        }
      } catch (error) {
        if (!cancelled) {
          setLibraryError(error instanceof Error ? error.message : 'Could not load wallpapers.')
        }
      }
    }

    async function loadDisplays() {
      try {
        const response = await fetch('/api/displays')
        if (!response.ok) throw new Error('Display discovery failed')
        const data = await response.json() as { displays: Display[] }
        if (!cancelled) setDisplays(data.displays)
      } catch {
        if (!cancelled) setDisplays([])
      }
    }

    async function loadServiceStatus() {
      try {
        const response = await fetch('/api/rotation/status')
        if (!response.ok) throw new Error('Status request failed')
        const data = await response.json() as {
          status: string
          intervalMinutes?: number
          folders?: string[]
          defaultFolder?: string
          rotationFolder?: string
        }
        if (!cancelled) {
          setRotationFolders(data.folders || [])
          setRotationFolder(data.rotationFolder || data.defaultFolder || '')
          setServiceStatus(data.status)
          setRotationPaused(data.status !== 'active')
          if (typeof data.intervalMinutes === 'number') {
            setInterval(data.intervalMinutes)
            setIntervalDraft(data.intervalMinutes)
          }
        }
      } catch {
        if (!cancelled) setServiceStatus('Unavailable')
      }
    }

    void loadLiveData()
    void loadDisplays()
    void loadServiceStatus()

    return () => {
      cancelled = true
    }
  }, [])

  async function refreshWallpaperData() {
    setScanning(true)
    try {
      const [wallpaperResponse, folderResponse] = await Promise.all([
        fetch('/api/wallpapers'),
        fetch('/api/wallpaper-folders'),
      ])

      if (!wallpaperResponse.ok) {
        throw new Error(`Wallpaper scan failed (${wallpaperResponse.status}).`)
      }
      if (!folderResponse.ok) {
        throw new Error(`Folder list failed (${folderResponse.status}).`)
      }

      const wallpaperData = await wallpaperResponse.json() as {
        wallpapers: WallpaperApiItem[]
      }
      const folderData = await folderResponse.json() as {
        folders: string[]
        defaultFolder: string
      }

      const items: Wallpaper[] = wallpaperData.wallpapers.map((item) => ({
        id: item.path,
        filename: item.path,
        name: displayName(item.name),
        category: wallpaperCategory(item.name),
        description: wallpaperDescription(item.name),
        colors: 'space',
        width: item.width,
        height: item.height,
        url: item.url,
      }))

      setWallpapers(items)
      setSelected((current) =>
        items.some((item) => item.id === current) ? current : (items[0]?.id ?? ''),
      )
      setLibraryError(items.length ? '' : 'No supported images found in your registered folders.')
      setWallpaperFolders(folderData.folders)
    } catch (error) {
      setLibraryError(error instanceof Error ? error.message : 'Could not scan wallpaper folders.')
    } finally {
      setScanning(false)
    }
  }

  async function changeWallpaperFolder(path: string, method: 'POST' | 'DELETE') {
    if (!path.trim() || folderBusy) return

    setFolderBusy(true)
    setFolderMessage(method === 'POST' ? 'Registering folder…' : 'Removing folder…')

    try {
      const response = await fetch('/api/wallpaper-folders', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: path.trim() }),
      })
      const data = await response.json() as {
        error?: string
        message?: string
      }

      if (!response.ok) {
        throw new Error(data.error || 'Could not update the folder list.')
      }

      setFolderMessage(data.message || 'Folder list updated.')
      if (method === 'POST') setFolderPath('')
      await refreshWallpaperData()
    } catch (error) {
      setFolderMessage(error instanceof Error ? error.message : 'Could not update the folder list.')
    } finally {
      setFolderBusy(false)
    }
  }

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshWallpaperData()
    }, 30000)

    return () => window.clearInterval(timer)
  }, [])

  async function handleApplyWallpaper() {
    if (!currentWallpaper.filename || applyState === 'applying') return

    setApplyState('applying')
    setApplyMessage('Applying wallpaper to your desktop…')

    try {
      const response = await fetch('/api/wallpapers/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: currentWallpaper.filename }),
      })
      const data = await response.json() as { error?: string; message?: string; output?: string }

      if (!response.ok) {
        throw new Error(data.error || data.message || 'The wallpaper could not be applied.')
      }

      setApplyState('success')
      setApplyMessage(data.message || 'Wallpaper applied successfully.')
    } catch (error) {
      setApplyState('error')
      setApplyMessage(error instanceof Error ? error.message : 'Could not apply wallpaper.')
    }
  }

  async function refreshRotationStatus() {
    const response = await fetch('/api/rotation/status')
    if (!response.ok) throw new Error('Could not refresh rotation status.')
    const data = await response.json() as {
      status: string
      intervalMinutes?: number
      folders?: string[]
      defaultFolder?: string
      rotationFolder?: string
    }

    setRotationFolders(data.folders || [])
    setRotationFolder(data.rotationFolder || data.defaultFolder || '')
    setServiceStatus(data.status)
    setRotationPaused(data.status !== 'active')

    if (typeof data.intervalMinutes === 'number') {
      setInterval(data.intervalMinutes)
      setIntervalDraft(data.intervalMinutes)
    }
  }

  async function handleRotationFolderChange(folder: string) {
    if (!folder || rotationBusy) return

    setRotationBusy(true)
    setRotationMessage('Saving rotation folder…')
    try {
      const response = await fetch('/api/rotation/folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder }),
      })
      const data = await response.json() as { error?: string; message?: string }
      if (!response.ok) throw new Error(data.error || 'Could not save rotation folder.')
      setRotationFolder(folder)
      setRotationMessage(data.message || 'Rotation folder saved.')
      await refreshRotationStatus()
    } catch (error) {
      setRotationMessage(error instanceof Error ? error.message : 'Could not save rotation folder.')
    } finally {
      setRotationBusy(false)
    }
  }

  async function handleSaveInterval() {
    if (rotationBusy || intervalDraft === interval) return

    setRotationBusy(true)
    setRotationMessage('Saving rotation interval…')

    try {
      const response = await fetch('/api/rotation/interval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minutes: intervalDraft }),
      })
      const data = await response.json() as {
        error?: string
        message?: string
      }

      if (!response.ok) {
        throw new Error(data.error || 'Could not save rotation interval.')
      }

      await refreshRotationStatus()
      setRotationMessage(data.message || 'Rotation interval saved.')
    } catch (error) {
      setRotationMessage(
        error instanceof Error ? error.message : 'Could not save rotation interval.',
      )
    } finally {
      setRotationBusy(false)
    }
  }

  async function handleRotationToggle() {
    if (rotationBusy) return

    const action = rotationPaused ? 'resume' : 'pause'
    setRotationBusy(true)
    setRotationMessage(
      action === 'pause' ? 'Pausing rotation…' : 'Resuming rotation…',
    )

    try {
      const response = await fetch(`/api/rotation/${action}`, {
        method: 'POST',
      })
      const data = await response.json() as {
        error?: string
        message?: string
      }

      if (!response.ok) {
        throw new Error(data.error || `Could not ${action} rotation.`)
      }

      await refreshRotationStatus()
      setRotationMessage(data.message || 'Rotation state updated.')
    } catch (error) {
      setRotationMessage(
        error instanceof Error ? error.message : `Could not ${action} rotation.`,
      )
    } finally {
      setRotationBusy(false)
    }
  }

  const isDark = theme === 'system' ? systemDark : theme === 'dark'

  useEffect(() => {
    document.documentElement.dataset.theme = isDark ? 'dark' : 'light'
  }, [isDark])

  const accentColor = accentOptions.find((option) => option.id === accent)?.color
    ?? '#579BFF'

  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--accent', accentColor)
    root.style.setProperty(
      '--accent-soft',
      `color-mix(in srgb, ${accentColor} 12%, transparent)`,
    )
    window.localStorage.setItem('horizon-accent', accent)
  }, [accent, accentColor])

  useEffect(() => {
    window.localStorage.setItem(
      'horizon-accent-collapsed',
      String(accentCollapsed),
    )
  }, [accentCollapsed])

  const currentWallpaper = wallpapers.find((wallpaper) => wallpaper.id === selected)
    ?? {
      id: '',
      filename: '',
      name: libraryError ? 'Library unavailable' : 'Loading wallpapers…',
      category: 'LOCAL LIBRARY',
      description: libraryError || 'Connecting to your wallpaper collection',
      colors: 'space',
      width: null,
      height: null,
      url: '',
    }

  const canvasWidth = displays.reduce(
    (rightEdge, display) => Math.max(rightEdge, display.x + display.width),
    0,
  )
  const canvasHeight = displays.reduce(
    (bottomEdge, display) => Math.max(bottomEdge, display.y + display.height),
    0,
  )

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <img className="brand-mark" src="/horizon-icon.svg" alt="" />
          <div>
            <div className="brand-name">horizon</div>
            <div className="brand-caption">WALLPAPER STUDIO</div>
          </div>
        </div>

        <div className="nav-label">WORKSPACE</div>
        <nav className="navigation">
          {[
            ['Overview', '◫'],
            ['Wallpaper library', '▧'],
            ['Displays', '▤'],
            ['Rotation', '⟳'],
          ].map(([label, icon]) => (
            <button
              className={`nav-item ${activeNav === label ? 'active' : ''}`}
              key={label}
              onClick={() => setActiveNav(label)}
            >
              <span className="nav-icon">{icon}</span>
              {label}
              {label === 'Wallpaper library' && (
                <span className="nav-count">{String(wallpapers.length).padStart(2, '0')}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="service-card">
            <div className="service-heading">
              <span className="status-dot" />
              <span>Rotation service</span>
            </div>
            <p>Background service status</p>
            <div className="service-status">
              <span>Systemd service</span>
              <strong>{serviceStatus}</strong>
            </div>
            <div className="service-note">
              Live status from your local systemd service.
            </div>
          </div>
          <div className="profile">
            <div className="avatar">T</div>
            <div className="profile-text">
              <strong>Horizon</strong>
              <span>Local workspace</span>
            </div>
            <span className="profile-menu">•••</span>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <span>/</span> <strong>{activeNav}</strong>
          </div>
          <div className="topbar-actions">
            <span className="local-badge"><span /> LOCAL</span>
            <button
              className="icon-button"
              title="Toggle theme"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            >
              {isDark ? '☼' : '☾'}
            </button>
            <div className="top-avatar">T</div>
          </div>
        </header>

        <div className="page-content">
          <div className="quick-apply-bar">
            <div className="quick-apply-copy">
              <span className="quick-apply-label">SELECTED WALLPAPER</span>
              <strong title={currentWallpaper.name}>{currentWallpaper.name}</strong>
            </div>
            <button
              className="primary-button"
              onClick={() => void handleApplyWallpaper()}
              disabled={!currentWallpaper.filename || applyState === 'applying'}
            >
              <span>{applyState === 'applying' ? '…' : '↗'}</span>
              {applyState === 'applying' ? 'Applying…' : 'Apply wallpaper'}
            </button>
          </div>
          {(activeNav === 'Overview') && (
          <section className="welcome-row">
            <div>
              <div className="eyebrow"><span className="eyebrow-spark">✳</span> YOUR DESKTOP, REIMAGINED</div>
              <h1>{greeting}<span className="accent">.</span></h1>
              <p className="subtitle">A little more atmosphere for your everyday workspace.</p>
            </div>
            <div className="theme-picker">
              <span>APPEARANCE</span>
              <div className="segmented">
                {(['system', 'light', 'dark'] as const).map((option) => (
                  <button
                    key={option}
                    className={theme === option ? 'chosen' : ''}
                    onClick={() => setTheme(option)}
                  >
                    {option === 'system' ? '◐' : option === 'light' ? '☼' : '☾'}
                    <span>{option[0].toUpperCase() + option.slice(1)}</span>
                  </button>
                ))}
              </div>
            </div>
          </section>
          )}

          {activeNav === 'Overview' && (
            <section className="accent-section" aria-labelledby="accent-heading">
              <div className="accent-heading">
                <div>
                  <div className="eyebrow">MAKE IT YOURS</div>
                  <h2 id="accent-heading">Accent colour</h2>
                  <p className="subtitle">Choose a colour for your Horizon interface.</p>
                </div>
                <div className="accent-heading-actions">
                  <span className="accent-current">{accentOptions.find((option) => option.id === accent)?.name}</span>
                  <button
                    type="button"
                    className="accent-toggle"
                    aria-expanded={!accentCollapsed}
                    aria-controls="accent-palette-options"
                    onClick={() => setAccentCollapsed((collapsed) => !collapsed)}
                  >
                    {accentCollapsed ? 'Show colours' : 'Hide colours'}
                    <span className={`accent-chevron ${accentCollapsed ? '' : 'expanded'}`} aria-hidden="true">⌄</span>
                  </button>
                </div>
              </div>
              {!accentCollapsed && (
                <div id="accent-palette-options" className="accent-palette" role="group" aria-label="Accent colour palette">
                  {accentOptions.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={`accent-swatch ${accent === option.id ? 'chosen' : ''}`}
                      onClick={() => setAccent(option.id)}
                      aria-label={option.name}
                      aria-pressed={accent === option.id}
                      title={`${option.name} · ${option.color}`}
                    >
                      <span
                        className="accent-swatch-colour"
                        style={{ backgroundColor: option.color }}
                      />
                      <span className="accent-swatch-name">{option.name}</span>
                      <span className="accent-swatch-check" aria-hidden="true">
                        {accent === option.id ? '✓' : ''}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}

          {(activeNav === 'Overview') && (
          <section className="stats-grid">
            <div className="stat-card">
              <div className="stat-top"><span>CONNECTED DISPLAYS</span><span className="stat-icon">▤</span></div>
              <div className="stat-number">{String(displays.length).padStart(2, '0')} <span className="stat-unit">displays</span></div>
              <div className="stat-foot"><span className="tiny-dot" /> Live display discovery</div>
            </div>
            <div className="stat-card">
              <div className="stat-top"><span>CANVAS SIZE</span><span className="stat-icon">⤢</span></div>
              <div className="stat-number">{canvasWidth || '—'}<span className="stat-x"> × </span>{canvasHeight || '—'}</div>
              <div className="stat-foot">Combined detected display geometry</div>
            </div>
            <div className="stat-card">
              <div className="stat-top"><span>ROTATION INTERVAL</span><span className="stat-icon">◷</span></div>
              <div className="stat-number">{interval}<span className="stat-unit"> min</span></div>
              <div className="stat-foot">Saved rotation schedule</div>
            </div>
          </section>
          )}

          {(activeNav === 'Overview') && (
          <section className="section-block">
            <div className="section-heading">
              <div>
                <div className="eyebrow">YOUR SETUP</div>
                <h2>Desktop preview</h2>
              </div>
              <span className="muted-label">{displays.length} DISPLAY{displays.length === 1 ? '' : 'S'} · {canvasWidth || '—'} × {canvasHeight || '—'}</span>
            </div>

            <div className="preview-card">
              <div className={`panorama ${currentWallpaper.colors} ${currentWallpaper.url ? 'has-image' : ''}`}>
                {currentWallpaper.url ? (
                  <img className="panorama-image" src={currentWallpaper.url} alt={currentWallpaper.name} />
                ) : (
                  <>
                    <div className="panorama-grain" />
                    <div className="preview-sun" />
                    <div className="mountain mountain-back" />
                    <div className="mountain mountain-front" />
                  </>
                )}
                <div className="panorama-copy">
                  <div className="preview-kicker">NOW SELECTED</div>
                  <div className="preview-title">{currentWallpaper.name}</div>
                  <div className="preview-description">{currentWallpaper.description}</div>
                </div>
                {displays.map((display) => (
                  <div
                    key={display.name}
                    className="display-outline"
                    style={{
                      left: `${canvasWidth ? (display.x / canvasWidth) * 100 : 0}%`,
                      width: `${canvasWidth ? (display.width / canvasWidth) * 100 : 50}%`,
                    }}
                  >
                    <span>{display.name}</span>
                  </div>
                ))}
                <div className="preview-resolution">
                  {canvasWidth || '—'} × {canvasHeight || '—'}
                </div>
              </div>
              <div className="preview-footer">
                <div className="preview-file">
                  <div className="file-icon">▧</div>
                  <div>
                    <strong>{currentWallpaper.name}</strong>
                    <span>{currentWallpaper.width && currentWallpaper.height ? `${currentWallpaper.width} × ${currentWallpaper.height}` : 'Local wallpaper'} · {displays.length} display{displays.length === 1 ? '' : 's'}</span>
                  </div>
                </div>
                <button
                  className="primary-button"
                  onClick={() => void handleApplyWallpaper()}
                  disabled={!currentWallpaper.filename || applyState === 'applying'}
                >
                  <span>{applyState === 'applying' ? '…' : '↗'}</span>
                  {applyState === 'applying' ? 'Applying…' : 'Apply wallpaper'}
                </button>
                {applyMessage && (
                  <div className={`apply-feedback ${applyState}`} role="status" aria-live="polite">
                    {applyMessage}
                  </div>
                )}
              </div>
            </div>
          </section>
          )}

          {activeNav === 'Displays' && (
            <section className="section-block">
              <div className="eyebrow">YOUR HARDWARE</div>
              <div className="section-heading">
                <div>
                  <h2>Connected displays</h2>
                  <p className="subtitle">Live geometry reported by COSMIC display discovery.</p>
                </div>
                <span className="muted-label">{displays.length} DISPLAY{displays.length === 1 ? '' : 'S'}</span>
              </div>

              <div className="stats-grid">
                {displays.map((display, index) => (
                  <div className="stat-card" key={display.name}>
                    <div className="stat-top">
                      <span>{index === 0 ? 'DISPLAY 1' : `DISPLAY ${index + 1}`}</span>
                      <span className="stat-icon">▤</span>
                    </div>
                    <div className="stat-number">{display.width} × {display.height}</div>
                    <div className="stat-foot">
                      {display.name} · Position {display.x}, {display.y}
                    </div>
                  </div>
                ))}
                {displays.length === 0 && (
                  <div className="library-note">No displays reported by the local API.</div>
                )}
              </div>

              <div className="library-note">
                <span className="note-icon">✳</span>
                Display names, resolutions, and positions are loaded from the local API.
              </div>
            </section>
          )}

          {(activeNav === 'Overview' || activeNav === 'Wallpaper library') && (
          <section className="section-block library-section">
            <div className="section-heading">
              <div>
                <div className="eyebrow">CURATED FOR YOUR DESKTOP</div>
                <h2>Wallpaper library</h2>
              </div>
              <button className="text-button" onClick={() => setActiveNav('Wallpaper library')}>
                View library <span>↗</span>
              </button>
            </div>

            <div className="wallpaper-grid">
              {wallpapers.map((wallpaper) => (
                <button
                  key={wallpaper.id}
                  className={`wallpaper-card ${selected === wallpaper.id ? 'selected' : ''}`}
                  onClick={() => setSelected(wallpaper.id)}
                >
                  <div className={`wallpaper-art ${wallpaper.colors} ${wallpaper.url ? 'has-image' : ''}`}>
                    {wallpaper.url ? (
                      <img className="wallpaper-image" src={wallpaper.url} alt="" loading="lazy" />
                    ) : (
                      <>
                        <div className="art-sun" />
                        <div className="art-hill art-hill-back" />
                        <div className="art-hill art-hill-front" />
                      </>
                    )}
                    {selected === wallpaper.id && <span className="selected-check">✓</span>}
                  </div>
                  <div className="wallpaper-info">
                    <div className="wallpaper-name">{wallpaper.name}</div>
                    <div className="wallpaper-category">{wallpaper.category}</div>
                  </div>
                </button>
              ))}
            </div>
            <div className="library-note">
              <span className="note-icon">✳</span>
              {libraryError || `${wallpapers.length} real wallpaper${wallpapers.length === 1 ? '' : 's'} loaded from your local collection.`}
            </div>

            <div className="folder-manager">
              <div className="folder-manager-heading">
                <div>
                  <div className="eyebrow">YOUR SOURCES</div>
                  <h3>Wallpaper folders</h3>
                  <p className="subtitle">Add any local folder containing supported images. New files are picked up automatically.</p>
                </div>
                <button
                  className="text-button"
                  onClick={() => void refreshWallpaperData()}
                  disabled={scanning}
                >
                  {scanning ? 'Scanning…' : '↻ Scan now'}
                </button>
              </div>

              <form
                className="folder-form"
                onSubmit={(event) => {
                  event.preventDefault()
                  void changeWallpaperFolder(folderPath, 'POST')
                }}
              >
                <input
                  className="folder-input"
                  value={folderPath}
                  onChange={(event) => setFolderPath(event.target.value)}
                  placeholder="/home/you/Pictures/Ultrawide"
                  aria-label="Folder path to register"
                  autoComplete="off"
                />
                <button className="primary-button" type="submit" disabled={folderBusy || !folderPath.trim()}>
                  {folderBusy ? 'Working…' : 'Add folder'}
                </button>
              </form>

              <div className="folder-list">
                {wallpaperFolders.length === 0 ? (
                  <p className="folder-empty">No extra folders registered yet.</p>
                ) : wallpaperFolders.map((folder) => (
                  <div className="folder-row" key={folder}>
                    <span className="folder-symbol">▰</span>
                    <span className="folder-path" title={folder}>{folder}</span>
                    <button
                      className="text-button folder-remove"
                      onClick={() => void changeWallpaperFolder(folder, 'DELETE')}
                      disabled={folderBusy}
                      type="button"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>

              {folderMessage && (
                <p className="folder-feedback" role="status">{folderMessage}</p>
              )}
            </div>
          </section>
          )}

          {(activeNav === 'Overview' || activeNav === 'Rotation') && (
          <section className="section-block rotation-section">
            <div className="section-heading">
              <div>
                <div className="eyebrow">AUTOMATION</div>
                <h2>Wallpaper rotation</h2>
              </div>
              <span className="preview-tag">SERVICE: {serviceStatus.toUpperCase()}</span>
            </div>
            <div className="rotation-card">
              <div className="rotation-intro">
                <div className="rotation-symbol">⟳</div>
                <div>
                  <h3>Keep things fresh</h3>
                  <p>Let Horizon change the scenery while you focus on what matters.</p>
                </div>
              </div>
              <div className="rotation-controls">
                <label htmlFor="rotation-folder">
                  <span>Rotate from folder</span>
                  <strong>{rotationFolder ? rotationFolder.split('/').filter(Boolean).slice(-2).join('/') : 'Choose folder'}</strong>
                </label>
                <select
                  id="rotation-folder"
                  className="rotation-folder-select"
                  value={rotationFolder}
                  onChange={(event) => void handleRotationFolderChange(event.target.value)}
                  disabled={rotationBusy}
                >
                  {rotationFolders.map((folder) => (
                    <option key={folder} value={folder}>{folder}</option>
                  ))}
                </select>
                <label htmlFor="interval">
                  <span>Switch every</span>
                  <strong>{intervalDraft} minutes</strong>
                </label>
                <input
                  id="interval"
                  type="range"
                  min="1"
                  max="120"
                  step="1"
                  value={intervalDraft}
                  onChange={(event) => {
                    setIntervalDraft(Number(event.target.value))
                    setRotationMessage('')
                  }}
                />
                <div className="range-labels"><span>1 min</span><span>120 min</span></div>
                <button
                  className="primary-button"
                  onClick={handleSaveInterval}
                  disabled={rotationBusy || intervalDraft === interval}
                >
                  {rotationBusy ? 'Working…' : 'Save interval'}
                </button>
              </div>
              <button
                className={`secondary-button ${rotationPaused ? 'resume-button' : ''}`}
                onClick={handleRotationToggle}
                disabled={rotationBusy}
              >
                {rotationBusy
                  ? 'Please wait…'
                  : rotationPaused ? '▶ Resume rotation' : 'Ⅱ Pause rotation'}
              </button>
            </div>
            <p className="disclaimer" role="status" aria-live="polite">
              {rotationMessage || `Rotation is ${serviceStatus === 'active' ? 'running' : 'not running'} · saved interval ${interval} minute${interval === 1 ? '' : 's'}.`}
            </p>
          </section>
          )}

          <footer className="footer">
            <span><span className="footer-mark">✳</span> Horizon <span className="footer-version">v1.0</span></span>
            <span>Made for your workspace <span className="footer-spark">✦</span></span>
          </footer>
        </div>
      </main>
    </div>
  )
}

export default App
