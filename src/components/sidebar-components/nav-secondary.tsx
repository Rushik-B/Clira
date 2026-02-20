import * as React from "react"

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar/sidebar"

// Custom icon type for our custom icons
type CustomIcon = React.ComponentType<{ className?: string; style?: React.CSSProperties }>

export function NavSecondary({
  items,
  ...props
}: {
  items: {
    title: string
    url: string
    icon: CustomIcon
    isActive?: boolean
    onClick?: () => void
  }[]
} & React.ComponentPropsWithoutRef<typeof SidebarGroup>) {
  return (
    <SidebarGroup {...props}>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton 
                size="sm"
                isActive={item.isActive}
                className="text-gray-300 hover:text-gray-200 hover:bg-gray-800/50 data-[active=true]:bg-blue-600/20 data-[active=true]:text-blue-300 cursor-pointer"
                onClick={item.onClick}
                asChild={!item.onClick}
              >
                {item.onClick ? (
                  <>
                    <item.icon />
                    <span>{item.title}</span>
                  </>
                ) : (
                  <a href={item.url} target={item.url.startsWith('http') ? '_blank' : undefined} rel={item.url.startsWith('http') ? 'noopener noreferrer' : undefined}>
                    <item.icon />
                    <span>{item.title}</span>
                  </a>
                )}
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
