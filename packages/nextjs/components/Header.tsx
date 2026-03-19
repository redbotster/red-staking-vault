"use client";

import React, { useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { hardhat } from "viem/chains";
import { Bars3Icon, BugAntIcon } from "@heroicons/react/24/outline";
import { FaucetButton, RainbowKitCustomConnectButton } from "~~/components/scaffold-eth";
import { useOutsideClick, useTargetNetwork } from "~~/hooks/scaffold-eth";

type HeaderMenuLink = {
  label: string;
  href: string;
  icon?: React.ReactNode;
};

export const menuLinks: HeaderMenuLink[] = [
  {
    label: "Stake",
    href: "/",
  },
  {
    label: "Debug",
    href: "/debug",
    icon: <BugAntIcon className="h-4 w-4" />,
  },
];

export const HeaderMenuLinks = () => {
  const pathname = usePathname();

  return (
    <>
      {menuLinks.map(({ label, href, icon }) => {
        const isActive = pathname === href;
        return (
          <li key={href}>
            <Link
              href={href}
              passHref
              className={`${
                isActive ? "bg-[#cc0000]/20 text-[#cc0000] font-bold" : "text-base-content"
              } hover:bg-[#cc0000]/10 hover:text-[#cc0000] py-1.5 px-3 text-sm rounded-lg gap-2 grid grid-flow-col tracking-wide uppercase`}
            >
              {icon}
              <span>{label}</span>
            </Link>
          </li>
        );
      })}
    </>
  );
};

/**
 * Site header — Red Lobster style
 */
export const Header = () => {
  const { targetNetwork } = useTargetNetwork();
  const isLocalNetwork = targetNetwork.id === hardhat.id;

  const burgerMenuRef = useRef<HTMLDetailsElement>(null);
  useOutsideClick(burgerMenuRef, () => {
    burgerMenuRef?.current?.removeAttribute("open");
  });

  return (
    <div className="sticky lg:static top-0 navbar bg-[#cc0000] min-h-0 shrink-0 justify-between z-20 shadow-lg px-0 sm:px-2">
      <div className="navbar-start w-auto lg:w-1/2">
        <details className="dropdown" ref={burgerMenuRef}>
          <summary className="ml-1 btn btn-ghost lg:hidden hover:bg-white/10 text-white">
            <Bars3Icon className="h-1/2" />
          </summary>
          <ul
            className="menu menu-compact dropdown-content mt-3 p-2 shadow-sm bg-base-100 rounded-box w-52"
            onClick={() => {
              burgerMenuRef?.current?.removeAttribute("open");
            }}
          >
            <HeaderMenuLinks />
          </ul>
        </details>
        <Link href="/" passHref className="hidden lg:flex items-center gap-3 ml-4 mr-6 shrink-0">
          <div className="flex relative w-10 h-10 rounded-full overflow-hidden border-2 border-white/30">
            <Image alt="RedBotster" className="cursor-pointer object-cover" fill src="/pfp.jpg" />
          </div>
          <div className="flex flex-col">
            <span className="font-bold leading-tight text-white text-lg tracking-wide" style={{ fontFamily: "Georgia, serif" }}>
              Red Botster
            </span>
            <span className="text-xs text-white/70 tracking-widest uppercase">Staking & Seafood</span>
          </div>
        </Link>
        <ul className="hidden lg:flex lg:flex-nowrap menu menu-horizontal px-1 gap-2">
          {menuLinks.map(({ label, href, icon }) => {
            const pathname = usePathname();
            const isActive = pathname === href;
            return (
              <li key={href}>
                <Link
                  href={href}
                  passHref
                  className={`${
                    isActive ? "bg-white/20 font-bold" : ""
                  } hover:bg-white/10 text-white py-1.5 px-3 text-sm rounded-lg gap-2 grid grid-flow-col tracking-wide uppercase`}
                >
                  {icon}
                  <span>{label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="navbar-end grow mr-4">
        <RainbowKitCustomConnectButton />
        {isLocalNetwork && <FaucetButton />}
      </div>
    </div>
  );
};
