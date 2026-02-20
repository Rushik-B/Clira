"use client"

import { ChevronRight } from "@/components/icons/icons"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/sidebar/collapsible"
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar/sidebar"

// Custom icon type for our custom icons
type CustomIcon = React.ComponentType<{ className?: string; style?: React.CSSProperties }>

export function NavMain({
  items,
}: {
  items: {
    title: string
    url: string
    icon: CustomIcon
    isActive?: boolean
    onClick?: () => void
    items?: {
      title: string
      url: string
      icon: CustomIcon
      onClick?: () => void
      isActive?: boolean
    }[]
  }[]
}) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>Platform</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => (
          <Collapsible key={item.title} asChild defaultOpen={item.isActive} open={item.isActive}>
            <SidebarMenuItem>
              <SidebarMenuButton 
                tooltip={item.title} 
                isActive={item.isActive}
                onClick={item.onClick}
              >
                <item.icon />
                <span>{item.title}</span>
              </SidebarMenuButton>
              {item.items?.length ? (
                <>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuAction className="data-[state=open]:rotate-90">
                      <ChevronRight />
                      <span className="sr-only">Toggle</span>
                    </SidebarMenuAction>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <SidebarMenuSub>
                      {item.items?.map((subItem) => (
                        <SidebarMenuSubItem key={subItem.title}>
                          <SidebarMenuSubButton 
                            onClick={subItem.onClick}
                            asChild={!subItem.onClick}
                            isActive={subItem.isActive}
                          >
                            {subItem.onClick ? (
                              <>
                                <subItem.icon className="text-muted-foreground" />
                                <span>{subItem.title}</span>
                              </>
                            ) : (
                              <a href={subItem.url}>
                                <subItem.icon className="text-muted-foreground" />
                                <span>{subItem.title}</span>
                              </a>
                            )}
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      ))}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </>
              ) : null}
            </SidebarMenuItem>
          </Collapsible>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  )
}
