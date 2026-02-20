"use client"

import {
  ChevronDown,
  ArrowRight,
} from "@/components/icons/icons"
import { signOut } from "next-auth/react"

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/sidebar/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/sidebar/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar/sidebar"

export function NavUser({
  user,
}: {
  user: {
    name: string
    email: string
    avatar: string
  }
}) {
  const { isMobile } = useSidebar()

  const handleSignOut = () => {
    signOut({ callbackUrl: '/' })
  }

  const userInitials = user.name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-[hsl(var(--sidebar-primary))]/10 data-[state=open]:text-[hsl(var(--sidebar-primary-foreground))] text-[hsl(var(--sidebar-primary-foreground))] hover:text-[hsl(var(--sidebar-primary-foreground))] hover:bg-[hsl(var(--sidebar-primary))]/10 rounded-2xl transition-colors duration-150"
            >
              <Avatar className="h-8 w-8 rounded-xl">
                <AvatarImage src={user.avatar} alt={user.name} />
                <AvatarFallback className="rounded-xl bg-[hsl(var(--sidebar-primary))] text-[hsl(var(--sidebar-primary-foreground))]">
                  {userInitials}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium text-white">{user.name}</span>
                <span className="truncate text-xs text-white/70">{user.email}</span>
              </div>
              <ChevronDown className="ml-auto size-4 text-white/70" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-2xl bg-[hsl(var(--sidebar-background))] border-[hsl(var(--sidebar-border))] shadow-elegant-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={8}
          >
            <DropdownMenuLabel className="p-0 font-normal text-white">
              <div className="flex items-center gap-3 px-3 py-2 text-left text-sm">
                <Avatar className="h-10 w-10 rounded-xl">
                  <AvatarImage src={user.avatar} alt={user.name} />
                  <AvatarFallback className="rounded-xl bg-[hsl(var(--sidebar-primary))] text-[hsl(var(--sidebar-primary-foreground))]">
                    {userInitials}
                  </AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold text-white">{user.name}</span>
                  <span className="truncate text-xs text-white/70">{user.email}</span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator className="bg-[hsl(var(--sidebar-border))]" />
            <DropdownMenuItem
              onClick={handleSignOut}
              className="bg-red-600 text-white hover:bg-red-700 hover:text-white cursor-pointer rounded-xl mx-1 mb-1 transition-colors duration-150 font-medium"
            >
              <ArrowRight className="text-white/90" />
              Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
