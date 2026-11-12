import Link from "next/link";
import type { User } from "@/lib/auth";
import { getDueReviewCount } from "@/lib/reviews";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";
import { Plus, Search } from "./icons";

export function AppHeader({ user }: { user: User }) {
  const dueReviews = getDueReviewCount(user.id);
  const initials = user.name
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <header className="app-header">
      <div className="app-wrap app-header-inner">
        <Link href="/dashboard" aria-label="Course Hero dashboard">
          <Logo />
        </Link>
        <nav className="app-nav" aria-label="Dashboard">
          <Link href="/dashboard">Dashboard</Link>
          <Link href="/courses">Courses</Link>
          <Link href="/roadmaps">Roadmaps</Link>
          <Link href="/review" className="nav-review">
            Review{dueReviews > 0 ? <span className="nav-count">{dueReviews}</span> : null}
          </Link>
          <Link href="/search" aria-label="Search your library" className="nav-search"><Search size={14} /></Link>
        </nav>
        <div className="app-user">
          <Link href="/new" className="btn btn-primary btn-sm" style={{ marginRight: 4 }}>
            <Plus size={14} /> New course
          </Link>
          <Link href="/profile" className="app-profile-link" title="Open your profile">
            <span className="app-user-name">{user.name}</span>
            <span className="avatar" aria-hidden="true">{initials}</span>
          </Link>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
