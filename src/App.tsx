import { HashRouter, NavLink, Route, Routes } from 'react-router-dom';
import { AppProvider, useApp } from './store';
import { SessionProvider, useSession } from './session';
import { ErrorState, Icon } from './components/common';
import HomeScreen from './screens/Home';
import LibraryScreen from './screens/Library';
import ExerciseDetailScreen from './screens/ExerciseDetail';
import PlannerScreen from './screens/Planner';
import CustomWorkoutsScreen from './screens/CustomWorkouts';
import PlayerScreen from './screens/Player';
import HistoryScreen from './screens/History';
import SettingsScreen from './screens/Settings';

function Shell() {
  const { loading, error } = useApp();
  const { session } = useSession();

  if (loading) {
    return (
      <div className="app-shell">
        <div className="loading-screen">Loading your library…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="app-shell">
        <div className="main">
          <ErrorState title="Could not load local data" message={error} />
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-badge">
            <Icon name="dumbbell" size={18} />
          </span>
          Workout Player
        </div>
        <nav className="nav" aria-label="Primary">
          <NavLink to="/" end>
            <Icon name="calendar" size={17} /> Today
          </NavLink>
          <NavLink to="/library">
            <Icon name="grid" size={17} /> Library
          </NavLink>
          <NavLink to="/plan">
            <Icon name="edit" size={17} /> Plan
          </NavLink>
          <NavLink to="/workouts">
            <Icon name="dumbbell" size={17} /> Workouts
          </NavLink>
          {session ? (
            <NavLink to="/play">
              <Icon name="play" size={17} /> Player
            </NavLink>
          ) : null}
          <NavLink to="/history">
            <Icon name="clock" size={17} /> History
          </NavLink>
          <NavLink to="/settings">
            <Icon name="settings" size={17} /> Settings
          </NavLink>
        </nav>
      </header>
      <main className="main">
        <Routes>
          <Route path="/" element={<HomeScreen />} />
          <Route path="/library" element={<LibraryScreen />} />
          <Route path="/exercises/:id" element={<ExerciseDetailScreen />} />
          <Route path="/plan" element={<PlannerScreen />} />
          <Route path="/workouts" element={<CustomWorkoutsScreen />} />
          <Route path="/play" element={<PlayerScreen />} />
          <Route path="/history" element={<HistoryScreen />} />
          <Route path="/settings" element={<SettingsScreen />} />
          <Route path="*" element={<HomeScreen />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <SessionProvider>
        <HashRouter>
          <Shell />
        </HashRouter>
      </SessionProvider>
    </AppProvider>
  );
}
