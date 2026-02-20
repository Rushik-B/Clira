"use client"

import * as React from "react"

import {
  Folder,
  ThreeDots,
  FolderOpen,
  Trash,
} from "@/components/icons/icons"
import { ChevronDown, ChevronUp } from 'lucide-react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/sidebar/dropdown-menu"
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar/sidebar"

// Custom icon type for our custom icons
type CustomIcon = React.ComponentType<{ className?: string; style?: React.CSSProperties }>

export function NavProjects({
  projects,
}: {
  projects: {
    id: string
    name: string
    url: string
    icon: CustomIcon
    color?: string
    style?: React.CSSProperties
    onClick: () => void
    isActive: boolean
  }[]
}) {
  const { isMobile } = useSidebar()
  const INITIAL_VISIBLE = 8
  const [showAll, setShowAll] = React.useState(false)

  const hasOverflow = projects.length > INITIAL_VISIBLE
  const visibleProjects = showAll ? projects : projects.slice(0, INITIAL_VISIBLE)

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>Labels</SidebarGroupLabel>
      <div className={showAll ? "max-h-[45vh] overflow-y-auto pr-1" : undefined}>
        <SidebarMenu>
        {visibleProjects.map((item) => (
          <SidebarMenuItem key={item.id}>
            <SidebarMenuButton 
              onClick={item.onClick}
              data-active={item.isActive}
              className={item.isActive ? "bg-sidebar-accent text-sidebar-accent-foreground" : ""}
            >
              <item.icon 
                className={item.color} 
                style={item.style}
              />
              <span>{item.name}</span>
            </SidebarMenuButton>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuAction showOnHover>
                  <ThreeDots />
                  <span className="sr-only">More</span>
                </SidebarMenuAction>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-48"
                side={isMobile ? "bottom" : "right"}
                align={isMobile ? "end" : "start"}
              >
                <DropdownMenuItem>
                  <FolderOpen className="text-muted-foreground" />
                  <span>View Project</span>
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Folder className="text-muted-foreground" />
                  <span>Share Project</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem>
                  <Trash className="text-muted-foreground" />
                  <span>Delete Project</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        ))}
        {/* Show more / less toggle */}
        {hasOverflow && (
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={() => setShowAll((v) => !v)}
              aria-expanded={showAll}
              className="justify-between"
            >
              <span className="truncate">
                {showAll ? 'Show less' : `Show ${projects.length - INITIAL_VISIBLE} more`}
              </span>
              {showAll ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
            </SidebarMenuButton>
          </SidebarMenuItem>
        )}
        </SidebarMenu>
      </div>
    </SidebarGroup>
  )
}
