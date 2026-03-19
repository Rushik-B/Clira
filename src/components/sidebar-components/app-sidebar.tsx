"use client"

import * as React from "react"
import {
  Inbox,
  Clock,
  Tabs,
  Lightning,
  Folder,
  SettingsGear,
  MessageSquare,
  Bookmark,
  Filter,
  OldPhone,
  PanelLeftOpen,
  Puzzle,
  User,
  Phone,
} from "@/components/icons/icons"
import { useSession } from 'next-auth/react'
import { PageType } from '@/types'
import { useFolderManagement } from '@/hooks/useFolderManagement'

import { NavMain } from "@/components/sidebar-components/nav-main"
import { NavProjects } from "@/components/sidebar-components/nav-projects"
import { NavSecondary } from "@/components/sidebar-components/nav-secondary"
import { NavUser } from "@/components/sidebar-components/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar/sidebar"
import { Sparkles } from "@/components/icons/icons"

// Custom icon type for our custom icons
type CustomIcon = React.ComponentType<{ className?: string; style?: React.CSSProperties }>

type SettingsSection = 'account-privacy' | 'assistant-replies' | 'skills' | 'folders-labels' | 'text-channels' | 'inboxes' | 'mcp-connections'

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  activePage: PageType
  setActivePage: (page: PageType, labelId?: string) => void
  activeLabelId: string | null
  activeSettingsSection: SettingsSection
  setActiveSettingsSection: (section: SettingsSection) => void
}

export function AppSidebar({ 
  activePage, 
  setActivePage, 
  activeLabelId,
  activeSettingsSection, 
  setActiveSettingsSection,
  ...props 
}: AppSidebarProps) {
  const { data: session } = useSession()
  const { labels } = useFolderManagement()
  const { state, toggleSidebar, isMobile } = useSidebar()

  const handleHowToUse = React.useCallback(() => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('queue-intro:open'))
    }

    if (isMobile) {
      toggleSidebar()
    }
  }, [isMobile, toggleSidebar])


  const handleNavigation = (page: PageType, settingsSection?: SettingsSection) => {
    setActivePage(page)
    if (settingsSection) {
      setActiveSettingsSection(settingsSection)
    }
  }

  const handleLabelNavigation = (labelId: string) => {
    setActivePage('label-queue', labelId)
  }

  const navMainData: {
    title: string
    url: string
    icon: CustomIcon
    isActive: boolean
    onClick: () => void
    items?: {
      title: string
      url: string
      icon: CustomIcon
      onClick?: () => void
      isActive?: boolean
    }[]
  }[] = [
    {
      title: "Queue",
      url: "#",
      icon: Inbox,
      isActive: activePage === 'queue',
      onClick: () => handleNavigation('queue'),
    },
    {
      title: "History", 
      url: "#",
      icon: Clock,
      isActive: activePage === 'history',
      onClick: () => handleNavigation('history'),
    },
    {
      title: "Metrics",
      url: "#", 
      icon: Tabs,
      isActive: activePage === 'metrics',
      onClick: () => handleNavigation('metrics'),
    },
    {
      title: "Voice Rules",
      url: "#",
      icon: Lightning,
      isActive: activePage === 'voice', 
      onClick: () => handleNavigation('voice'),
    },
    {
      title: "Folders",
      url: "#",
      icon: Folder,
      isActive: activePage === 'folders',
      onClick: () => handleNavigation('folders'),
    },
    {
      title: "Settings",
      url: "#",
      icon: SettingsGear,
      isActive: activePage === 'settings',
      onClick: () => handleNavigation('settings', 'account-privacy'),
      items: [
        {
          title: "Account & Privacy",
          url: "/settings/account-privacy",
          icon: User,
          onClick: () => handleNavigation('settings', 'account-privacy'),
          isActive: activeSettingsSection === 'account-privacy'
        },
        {
          title: "Assistant & Replies",
          url: "/settings/assistant-replies",
          icon: Filter,
          onClick: () => handleNavigation('settings', 'assistant-replies'),
          isActive: activeSettingsSection === 'assistant-replies'
        },
        {
          title: "Skills",
          url: "/settings/skills",
          icon: Sparkles,
          onClick: () => handleNavigation('settings', 'skills'),
          isActive: activeSettingsSection === 'skills'
        },
        {
          title: "Folders & Labels",
          url: "/settings/folders-labels",
          icon: Bookmark,
          onClick: () => handleNavigation('settings', 'folders-labels'),
          isActive: activeSettingsSection === 'folders-labels'
        },
        {
          title: "Text Clira",
          url: "/settings/text-channels",
          icon: Phone,
          onClick: () => handleNavigation('settings', 'text-channels'),
          isActive: activeSettingsSection === 'text-channels'
        },
        {
          title: "Inboxes",
          url: "/settings/inboxes",
          icon: Inbox,
          onClick: () => handleNavigation('settings', 'inboxes'),
          isActive: activeSettingsSection === 'inboxes'
        },
        {
          title: "MCP Servers",
          url: "/settings/mcp-connections",
          icon: Puzzle,
          onClick: () => handleNavigation('settings', 'mcp-connections'),
          isActive: activeSettingsSection === 'mcp-connections'
        }
      ]
    },
  ]

  const navSecondaryData: {
    title: string
    url: string
    icon: CustomIcon
    isActive?: boolean
    onClick?: () => void
  }[] = [
    {
      title: "Feedback",
      url: "/feedback",
      icon: MessageSquare,
      isActive: activePage === 'feedback',
      onClick: () => handleNavigation('feedback'),
    },
    {
      title: "Support", 
      url: "/support",
      icon: OldPhone,
    },
  ]

  // No loading states - just show labels instantly or empty state
  const projectsData: {
    id: string
    name: string
    url: string
    icon: CustomIcon
    color?: string
    style?: React.CSSProperties
    onClick: () => void
    isActive: boolean
  }[] = labels.length === 0 
    ? [] // Empty array for no labels - will show empty state in NavProjects
    : labels.map((label) => {
        // Use the actual Gmail label color if available
        const labelColor = label.color || label.backgroundColor;
        const isActive = activePage === 'label-queue' && activeLabelId === label.id;
        
        if (labelColor && labelColor.startsWith('#')) {
          // For hex colors, use inline style
          return {
            id: label.id,
            name: label.name,
            url: "#",
            icon: Bookmark,
            style: { color: labelColor },
            onClick: () => handleLabelNavigation(label.id),
            isActive
          };
        } else if (labelColor) {
          // For non-hex colors, try to use as Tailwind class
          return {
            id: label.id,
            name: label.name,
            url: "#",
            icon: Bookmark,
            color: labelColor,
            onClick: () => handleLabelNavigation(label.id),
            isActive
          };
        } else {
          // Fallback to a default color
          return {
            id: label.id,
            name: label.name,
            url: "#",
            icon: Bookmark,
            color: "text-gray-400",
            onClick: () => handleLabelNavigation(label.id),
            isActive
          };
        }
      })

  const userData = session ? {
    name: session.user?.name || "User",
    email: session.user?.email || "",
    avatar: session.user?.image || "/avatars/default.jpg",
  } : {
    name: "User",
    email: "",
    avatar: "/avatars/default.jpg", 
  }

  return (
    <Sidebar variant="inset" collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <div className="cursor-pointer flex items-center justify-between py-3 px-2">
                <div className="flex items-center gap-1" style={{ marginLeft: state === "collapsed" ? "-4px" : "-11px", marginRight: state === "collapsed" ? "-4px" : "-11px" }}>
                  <img 
                    src="/logo.png" 
                    alt="Clira Logo" 
                    className={`object-contain filter brightness-0 invert transition-all duration-100 ${
                      state === "collapsed" ? "size-14" : "size-11"
                    }`}
                  />
                  <span className="text-xl font-bold text-white tracking-wide group-data-[collapsible=icon]:hidden">
                    Clira
                  </span>
                </div>
                <div
                  onClick={toggleSidebar}
                  className="flex items-center justify-center size-8 rounded-md hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors cursor-pointer group-data-[collapsible=icon]:hidden"
                  aria-label="Toggle Sidebar"
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && toggleSidebar()}
                >
                  <PanelLeftOpen className="size-4" />
                </div>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent className={state === "collapsed" ? "gap-3" : ""}>
        {/* Expand button for collapsed state - positioned above main navigation */}
        {state === "collapsed" && (
          <div className="flex justify-center px-2 pt-3 relative z-10">
            <SidebarMenuButton
              onClick={toggleSidebar}
              tooltip="Expand Sidebar"
              className="shrink-0 relative z-10"
              aria-label="Expand Sidebar"
            >
              <PanelLeftOpen className="size-4" />
            </SidebarMenuButton>
          </div>
        )}
        <div className={state === "collapsed" ? "-mt-4" : ""}>
          <NavMain items={navMainData} />
        </div>
        <NavProjects projects={projectsData} />
        <NavSecondary items={navSecondaryData} className="mt-auto" />
        {isMobile && activePage === 'queue' && (
          <SidebarMenu className="mt-2">
            <SidebarMenuItem>
              <SidebarMenuButton
                size="lg"
                className="group w-full rounded-2xl border border-white/10 bg-white/[0.03] text-white hover:bg-white/[0.06] hover:text-white focus-visible:ring-2 focus-visible:ring-blue-500/40"
                onClick={handleHowToUse}
              >
                <span className="flex size-9 items-center justify-center rounded-xl bg-blue-500/20 text-blue-200 transition-colors duration-150 group-hover:bg-blue-500/30">
                  <Sparkles className="h-4 w-4" />
                </span>
                <span className="flex flex-col text-left">
                  <span className="text-sm font-semibold leading-tight">How to use</span>
                  <span className="text-xs font-medium text-white/60">Tour the Clira workflow</span>
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        )}
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={userData} />
      </SidebarFooter>
    </Sidebar>
  )
}
