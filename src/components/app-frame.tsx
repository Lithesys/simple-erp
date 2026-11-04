"use client";

import { AppButton } from "@/components/app-button";
import Link from "next/link";
import {
  Boxes,
  LogOut,
  Menu,
  MoreHorizontal,
  UserRound,
} from "lucide-react";
import { LoadingSkeleton } from "@/components/loading-skeleton";
import { PosOrderTabs } from "@/components/pos-order-tabs";
import { useAppFrameActions } from "@/components/app-frame/hooks/use-app-frame-actions";
import { useAppFrameMenu } from "@/components/app-frame/hooks/use-app-frame-menu";
import { useAppRoute } from "@/components/app-frame/hooks/use-app-route";
import { useDocumentTitle } from "@/components/app-frame/hooks/use-document-title";
import { useNavigationFeedback } from "@/components/app-frame/hooks/use-navigation-feedback";
import { useNavigationModel } from "@/components/app-frame/hooks/use-navigation-model";
import { useUserAccess } from "@/components/app-frame/hooks/use-user-access";
import { getMobileHref } from "@/lib/mobile-routes";
import { mergeClassNames } from "@/lib/class-names";
import { useStoreBrand } from "@/components/store-brand-provider";

export function AppFrame({ children }: { children: React.ReactNode }) {
  const { pathname, isMobileRoute, desktopPathname } = useAppRoute();
  const { access, signOut } = useUserAccess();
  const { displayName } = useStoreBrand();
  const { navigationPending, handleShellNavigationClick } =
    useNavigationFeedback(pathname, isMobileRoute);
  const {
    openMenu,
    mobileMenuOpen,
    mobileMenuTriggerRef,
    mobileMoreButtonRef,
    mobileMoreCloseRef,
    togglePrimaryMenu,
    openPrimaryMenu,
    leavePrimaryMenu,
    closePrimaryMenu,
    closeMobileMenu,
    toggleMobileMenu,
    handleMobileMenuKeyDown,
  } = useAppFrameMenu();
  const {
    accessibleNav,
    canSell,
    isPos,
    managementHref,
    mobileNavItems,
    currentPageLabel,
    currentPageIsInMobileNav,
  } = useNavigationModel(access, desktopPathname, displayName);
  const { handleSignOut, handleMobileSignOut } = useAppFrameActions({
    closeMobileMenu,
    signOut,
  });
  useDocumentTitle(desktopPathname);

  if (!access)
    return (
      <div className="main">
        <LoadingSkeleton rows={7} />
      </div>
    );

  return (
    <div
      className={mergeClassNames(
        "app-shell",
        isPos && "pos-shell",
        isMobileRoute && "mobile-route",
      )}
      aria-busy={navigationPending}
      onClickCapture={handleShellNavigationClick}
    >
      <header
        className="topbar no-print"
        inert={mobileMenuOpen || navigationPending}
      >
        <div className="topbar-leading">
          <Link
            href={
              isMobileRoute
                ? getMobileHref(canSell ? "/pos" : managementHref)
                : canSell
                  ? "/pos"
                  : managementHref
            }
            className="brand brand-home"
            aria-label={displayName}
          >
            <span className="brand-mark">
              <Boxes size={18} />
            </span>
            <span>{displayName}</span>
          </Link>
          <AppButton
            variant="ghost"
            type="button"
            className="mobile-menu-trigger brand-mobile-menu-trigger"
            ref={mobileMenuTriggerRef}
            aria-label={
              mobileMenuOpen ? "Đóng điều hướng chính" : "Mở điều hướng chính"
            }
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-more-menu"
            onClick={() => toggleMobileMenu(mobileMenuTriggerRef.current)}
          >
            <Menu size={20} aria-hidden="true" />
          </AppButton>
          <span className="mobile-route-title" aria-hidden="true">
            {currentPageLabel}
          </span>
          {isPos && canSell && <PosOrderTabs />}
        </div>
        <nav className="workspace-switch" aria-label="Khu vực làm việc">
          {canSell && (
            <Link
              href={isMobileRoute ? getMobileHref("/pos") : "/pos"}
              aria-current={isPos ? "page" : undefined}
            >
              Bán hàng
            </Link>
          )}
          <Link
            href={
              isMobileRoute ? getMobileHref(managementHref) : managementHref
            }
            aria-current={!isPos ? "page" : undefined}
          >
            Quản lý
          </Link>
        </nav>
        <div className="topbar-right">
          <Link
            href={isMobileRoute ? getMobileHref("/account") : "/account"}
            className="header-account"
            aria-label={`Tài khoản của ${access.name}`}
          >
            <UserRound size={16} />
            <span>{access.name}</span>
          </Link>
          <span className="user-role">{access.role}</span>
          <AppButton
            variant="ghost"
            className="logout-button"
            title="Đăng xuất"
            onClick={handleSignOut}
          >
            <LogOut size={17} />
            <span>Đăng xuất</span>
          </AppButton>
        </div>
      </header>
      {!isPos && (
        <nav
          className="primary-nav no-print"
          aria-label="Điều hướng chính"
          inert={mobileMenuOpen || navigationPending}
        >
          {accessibleNav.map(({ label, children }) => {
            const active = children.some(
              ({ href }) =>
                desktopPathname === href ||
                desktopPathname.startsWith(href + "/"),
            );
            const menuId = `primary-nav-menu-${label.replace(/\W+/g, "-").toLowerCase()}`;
            const expanded = openMenu === label;
            return (
              <div
                key={label}
                className="primary-nav-group"
                onMouseEnter={() => openPrimaryMenu(label)}
                onMouseLeave={() => leavePrimaryMenu(label)}
                onFocus={() => openPrimaryMenu(label)}
              >
                <AppButton
                  variant="ghost"
                  type="button"
                  className={mergeClassNames(
                    "primary-nav-link",
                    active && "active",
                  )}
                  aria-haspopup="menu"
                  aria-expanded={expanded}
                  aria-controls={menuId}
                  onClick={() => togglePrimaryMenu(label)}
                >
                  <span>{label}</span>
                </AppButton>
                {expanded && (
                  <div
                    id={menuId}
                    className="primary-nav-menu"
                    role="menu"
                    aria-label={`${label} menu`}
                  >
                    <section className="primary-nav-menu-section">
                      <h2>{label}</h2>
                      <div className="primary-nav-menu-links">
                        {children.map(({ href, label: childLabel }) => (
                          <Link
                            key={href}
                            href={isMobileRoute ? getMobileHref(href) : href}
                            role="menuitem"
                            aria-current={
                              desktopPathname === href ||
                              desktopPathname.startsWith(href + "/")
                                ? "page"
                                : undefined
                            }
                            onClick={closePrimaryMenu}
                          >
                            {childLabel}
                          </Link>
                        ))}
                      </div>
                    </section>
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      )}
      {isPos ? (
        <div className="pos-content" inert={mobileMenuOpen || navigationPending}>
          {children}
        </div>
      ) : (
        <main className="main" inert={mobileMenuOpen || navigationPending}>
          {children}
        </main>
      )}
      {isMobileRoute && navigationPending && (
        <>
          <div
            className="mobile-route-transition-backdrop"
            aria-hidden="true"
          />
          <div
            className="mobile-route-progress"
            role="progressbar"
            aria-label="Đang chuyển trang"
          />
        </>
      )}
      <div
        className="mobile-navigation no-print"
        inert={navigationPending}
      >
        <AppButton
          variant="ghost"
          type="button"
          className="mobile-menu-backdrop"
          aria-label="Đóng menu điều hướng"
          tabIndex={-1}
          hidden={!mobileMenuOpen}
          onClick={closeMobileMenu}
        />
        <div
          id="mobile-more-menu"
          className="mobile-more-menu"
          role="dialog"
          aria-modal="true"
          aria-label="Điều hướng"
          hidden={!mobileMenuOpen}
          onKeyDown={handleMobileMenuKeyDown}
        >
          <div className="mobile-more-heading">
            <div>
              <strong>Điều hướng</strong>
              <span>Truy cập nhanh các khu vực</span>
            </div>
            <AppButton
              variant="ghost"
              type="button"
              className="mobile-more-close"
              ref={mobileMoreCloseRef}
              aria-label="Đóng menu điều hướng"
              onClick={closeMobileMenu}
            >
              <span aria-hidden="true">×</span>
            </AppButton>
          </div>
          <nav className="mobile-more-groups" aria-label="Các khu vực">
            {accessibleNav.map(({ label, children: links }) => (
              <section className="mobile-more-group" key={label}>
                <h2>{label}</h2>
                {links.map(({ href, label: linkLabel }) => (
                  <Link
                    key={href}
                    aria-current={
                      desktopPathname === href ||
                      desktopPathname.startsWith(`${href}/`)
                        ? "page"
                        : undefined
                    }
                    href={isMobileRoute ? getMobileHref(href) : href}
                    onClick={closeMobileMenu}
                  >
                    <span>{linkLabel}</span>
                    <span className="mobile-more-chevron" aria-hidden="true">
                      ›
                    </span>
                  </Link>
                ))}
              </section>
            ))}
            <section className="mobile-more-group mobile-more-account">
              <h2>Tài khoản</h2>
              <Link
                href={isMobileRoute ? getMobileHref("/account") : "/account"}
                aria-current={
                  desktopPathname === "/account" ? "page" : undefined
                }
                onClick={closeMobileMenu}
              >
                <span>Tài khoản cá nhân</span>
                <span className="mobile-more-chevron" aria-hidden="true">
                  ›
                </span>
              </Link>
              <AppButton
                variant="ghost"
                type="button"
                onClick={handleMobileSignOut}
              >
                <span>Đăng xuất</span>
                <LogOut size={17} aria-hidden="true" />
              </AppButton>
            </section>
          </nav>
        </div>
        <nav
          className="mobile-bottom-nav"
          aria-label="Điều hướng chính"
          inert={mobileMenuOpen}
        >
          {mobileNavItems.map(({ href, label, icon: Icon }) => {
            const active =
              desktopPathname === href ||
              desktopPathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={isMobileRoute ? getMobileHref(href) : href}
                className={mergeClassNames(
                  "mobile-bottom-link",
                  active && "active",
                )}
                aria-current={active ? "page" : undefined}
                onClick={closeMobileMenu}
              >
                <Icon size={20} strokeWidth={2} aria-hidden="true" />
                <span>{label}</span>
              </Link>
            );
          })}
          <AppButton
            variant="ghost"
            type="button"
            ref={mobileMoreButtonRef}
            className={mergeClassNames(
              "mobile-bottom-link",
              (mobileMenuOpen || !currentPageIsInMobileNav) && "active",
            )}
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-more-menu"
            onClick={() => toggleMobileMenu(mobileMoreButtonRef.current)}
          >
            <MoreHorizontal size={20} strokeWidth={2} aria-hidden="true" />
            <span>Thêm</span>
          </AppButton>
        </nav>
      </div>
    </div>
  );
}
