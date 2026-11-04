import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import Home from '@/pages/home';
import RoomPage from '@/pages/room-lakou';
import SignInPage from '@/pages/sign-in';
import SignUpPage from '@/pages/sign-up';
import SocialPage from '@/pages/social';
import HowToPlayPage from '@/pages/how-to-play';
import TicTacToePage from '@/pages/tic-tac-toe';
import MopyonPage from '@/pages/mopyon';
import BlockDropPage from '@/pages/block-drop';
import ClassicGamesPage from '@/pages/classic-games';
import ScrabblePage from '@/pages/scrabble';
import BarricadePage from '@/pages/barricade';
import AboutPage from '@/pages/about';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient();

function Router() {
  return (
    // Keep a shared shell (sidebar, navbar) outside the boundary so it
    // survives a page crash.
    <RoutedErrorBoundary>
      <Switch>
         <Route path="/"><SocialPage page="home" /></Route>
         <Route path="/games"><SocialPage page="games" /></Route>
         <Route path="/games/tic-tac-toe" component={TicTacToePage} />
         <Route path="/games/mopyon" component={MopyonPage} />
         <Route path="/games/block-drop" component={BlockDropPage} />
         <Route path="/games/tic-tac-toe/:code" component={TicTacToePage} />
         <Route path="/games/box" component={ClassicGamesPage} />
         <Route path="/games/kay" component={ClassicGamesPage} />
         <Route path="/games/chess" component={ClassicGamesPage} />
         <Route path="/games/dame" component={ClassicGamesPage} />
         <Route path="/games/words" component={ClassicGamesPage} />
         <Route path="/games/four-in-a-row" component={ClassicGamesPage} />
         <Route path="/games/filler" component={ClassicGamesPage} />
         <Route path="/games/scrabble" component={ScrabblePage} />
         <Route path="/games/barricade" component={BarricadePage} />
         <Route path="/friends"><SocialPage page="friends" /></Route>
         <Route path="/leaderboard"><SocialPage page="leaderboard" /></Route>
         <Route path="/profile"><SocialPage page="profile" /></Route>
          <Route path="/games/domino" component={Home} />
          <Route path="/games/lakou" component={Home} />
          <Route path="/sign-in" component={SignInPage} />
          <Route path="/sign-up" component={SignUpPage} />
          <Route path="/how-to-play" component={HowToPlayPage} />
          <Route path="/about" component={AboutPage} />
         <Route path="/room/:code" component={RoomPage} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
