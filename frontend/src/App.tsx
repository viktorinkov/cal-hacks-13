import { useEffect, useMemo, type ReactNode } from 'react'
import { RotateCw } from 'lucide-react'
import { readConfig } from '@/app/config'
import { ClaimsDesk } from '@/components/claims/ClaimsDesk'
import { CommandCenter } from '@/components/dashboard/CommandCenter'
import { AttendeesPage } from '@/components/desk/AttendeesPage'
import { BandsPage } from '@/components/desk/BandsPage'
import { CamerasPage } from '@/components/desk/CamerasPage'
import { CostsPage } from '@/components/desk/CostsPage'
import { RulesPage } from '@/components/desk/RulesPage'
import { GraphPage } from '@/components/desk/GraphPage'
import { KibanaPage } from '@/components/desk/KibanaPage'
import { MerchPage } from '@/components/desk/MerchPage'
import { PaymentsPage } from '@/components/desk/PaymentsPage'
import { PhotosPage } from '@/components/desk/PhotosPage'
import { RunPage } from '@/components/desk/RunPage'
import { StaffPage } from '@/components/desk/StaffPage'
import { TestBandsPage } from '@/components/desk/TestBandsPage'
import { ViewAsPage } from '@/components/desk/ViewAsPage'
import { PhotographerPage } from '@/components/photo/PhotographerPage'
import { VenuePage } from '@/components/desk/VenuePage'
import { JoinPage } from '@/components/join/JoinPage'
import { RegisterPage } from '@/components/join/RegisterPage'
import { WalletPage } from '@/components/wallet/WalletPage'
import { Button } from '@/components/ui/button'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { OrganizerGate, SignInCallback } from '@/components/organizer/OrganizerGate'
import { RouteProvider, useRoute } from '@/cover/route'
import { createAdapter, getSync, startRuntime, stopRuntime } from '@/services/runtime'
import { startSession } from '@/stdb/session'
import { useConnection } from '@/stores/connection'
import { useWorld } from '@/stores/world'

function Boot() {
  const ready = useWorld((s) => s.ready)
  const sync = useConnection((s) => s.sync)
  const error = useConnection((s) => s.syncError)
  if (ready) return <CommandCenter />
  return (
    <div className="grid h-full place-items-center bg-ground">
      <div className="flex max-w-md flex-col items-start gap-4 px-8">
        <span className="font-display text-[34px] leading-none text-ink">BandIt</span>
        {sync === 'error' ? (
          <>
            <p className="text-[15px] text-ink">Could not load the venue from the backend.</p>
            <p className="text-[13px] text-ink-muted">{error}</p>
            <Button variant="outline" onClick={() => void getSync()?.resync()}>
              <RotateCw /> Try again
            </Button>
          </>
        ) : (
          <p className="text-[15px] text-ink-dim" role="status">
            Loading the venue…
          </p>
        )}
      </div>
    </div>
  )
}

function Connected({ children }: { children: ReactNode }) {
  const config = useMemo(() => readConfig(), [])
  useEffect(() => {
    const adapter = createAdapter(config)
    startRuntime(adapter)
    startSession()
    return () => stopRuntime()
  }, [config])
  return children
}

function Pages() {
  const { path } = useRoute()
  if (path === '/join') return <JoinPage />
  if (path === '/register') return <RegisterPage />
  if (path === '/wallet') return <WalletPage />
  if (path === '/payments') return <PaymentsPage />
  if (path === '/claims') return <ClaimsDesk />
  if (path === '/rules') return <RulesPage />
  if (path === '/attendees') return <AttendeesPage />
  if (path === '/staff') return <StaffPage />
  if (path === '/view-as') return <ViewAsPage />
  if (path === '/run') return <RunPage />
  if (path === '/bands') return <BandsPage />
  if (path === '/cameras') return <CamerasPage />
  if (path === '/test-bands') return <TestBandsPage />
  if (path === '/photos') return <PhotosPage />
  if (path === '/photo') return <PhotographerPage />
  if (path === '/merch') return <MerchPage />
  if (path === '/graph') return <GraphPage />
  if (path === '/costs') return <CostsPage />
  if (path === '/venue') return <VenuePage />
  if (path === '/kibana') return <KibanaPage />
  return <Boot />
}

function Shell() {
  const { path } = useRoute()
  if (path === '/callback') return <SignInCallback />
  const attendeePage = path === '/join' || path === '/register' || path === '/wallet'
  return (
    <Connected>
      {path === '/organizer' || (window.location.hostname === 'band1t.vip' && !attendeePage) ? (
        <OrganizerGate>
          <Pages />
        </OrganizerGate>
      ) : (
        <Pages />
      )}
    </Connected>
  )
}

export default function App() {
  return (
    <RouteProvider>
      <TooltipProvider delayDuration={250}>
        <Shell />
        <Toaster position="top-center" />
      </TooltipProvider>
    </RouteProvider>
  )
}
