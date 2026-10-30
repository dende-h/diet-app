import { ClerkLoading, Show, SignIn } from '@clerk/react'
import { useState, type ReactNode } from 'react'
import { APP_NAME, useFeedback, useRoute, useToday, type Route } from './lib'
import { Graph } from './pages/Graph'
import { History } from './pages/History'
import { Home } from './pages/Home'
import { Settings } from './pages/Settings'
import { DataProvider, useStore } from './store'

export default function App() {
  return (
    <>
      <ClerkLoading>
        <div className="splash">読み込み中…</div>
      </ClerkLoading>
      <Show when="signed-out">
        <main className="signin">
          <h1 className="brand">{APP_NAME}</h1>
          <SignIn routing="hash" withSignUp />
        </main>
      </Show>
      <Show when="signed-in">
        <DataProvider>
          <AuthedApp />
        </DataProvider>
      </Show>
    </>
  )
}

function AuthedApp() {
  const { data, error, reload } = useStore()
  const today = useToday()
  const [route, navigate] = useRoute()
  const [date, setDate] = useState(today)
  const [prevToday, setPrevToday] = useState(today)
  const ready = Boolean(data?.profile && data?.goal)
  // 起動時に（その日まだなら）AIフィードバックを生成しておく
  const feedback = useFeedback(today, ready)

  // 開いたまま日付が変わったら、表示中の日付も今日に進める
  if (prevToday !== today) {
    setPrevToday(today)
    setDate(today)
  }

  if (!data) {
    return error ? (
      <div className="splash">
        <p>データを読み込めませんでした</p>
        <button className="button" onClick={() => void reload()}>
          再読み込み
        </button>
      </div>
    ) : (
      <div className="splash">読み込み中…</div>
    )
  }

  if (!ready) {
    return (
      <main className="page">
        <Settings onboarding onSaved={() => navigate('home')} />
      </main>
    )
  }

  let page: ReactNode
  switch (route) {
    case 'history':
      page = (
        <History
          today={today}
          onSelect={(d) => {
            setDate(d)
            navigate('home')
          }}
        />
      )
      break
    case 'graph':
      page = <Graph today={today} />
      break
    case 'settings':
      page = <Settings onSaved={() => navigate('home')} />
      break
    default:
      page = <Home date={date} setDate={setDate} today={today} feedback={feedback} />
  }

  return (
    <div className="app">
      <main className={route === 'graph' ? 'page page-graph' : 'page'}>{page}</main>
      <TabBar route={route} navigate={navigate} />
    </div>
  )
}

const TABS: { route: Route; label: string; icon: ReactNode }[] = [
  {
    route: 'home',
    label: '今日',
    icon: <path d="M4 11 12 4l8 7v9h-5v-6H9v6H4z" />,
  },
  {
    route: 'history',
    label: '履歴',
    icon: <path d="M5 5h14M5 12h14M5 19h14" />,
  },
  {
    route: 'graph',
    label: 'グラフ',
    icon: <path d="M3 6l6 6 4-4 8 9" />,
  },
  {
    route: 'settings',
    label: '設定',
    icon: (
      <>
        <circle cx="12" cy="12" r="3.2" />
        <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" />
      </>
    ),
  },
]

function TabBar({ route, navigate }: { route: Route; navigate: (r: Route) => void }) {
  return (
    <nav className="tabbar">
      {TABS.map((t) => (
        <button
          key={t.route}
          className={route === t.route ? 'tab active' : 'tab'}
          onClick={() => navigate(t.route)}
          aria-current={route === t.route ? 'page' : undefined}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            {t.icon}
          </svg>
          <span>{t.label}</span>
        </button>
      ))}
    </nav>
  )
}
