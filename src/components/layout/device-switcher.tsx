'use client';

import { Check, ChevronsUpDown, Plus, Cpu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useSysConfig } from '@/components/providers/sys-config-provider';
import Link from 'next/link';

export function DeviceSwitcher() {
  const { config, switchDevice } = useSysConfig();
  if (!config) return null;

  const active = config.devices.find((d) => d.device_id === config.active_device_id) ?? config.devices[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 min-w-[10rem] justify-between"
          data-testid="device-switcher-trigger"
        >
          <span className="inline-flex items-center gap-1.5 min-w-0">
            <Cpu className="w-3.5 h-3.5 text-primary shrink-0" />
            <span className="truncate text-xs font-medium">{active.label}</span>
          </span>
          <ChevronsUpDown className="w-3.5 h-3.5 opacity-70 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Perangkat ({config.devices.length})
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {config.devices.map((device) => {
          const isActive = device.device_id === config.active_device_id;
          return (
            <DropdownMenuItem
              key={device.device_id}
              onSelect={() => {
                if (!isActive) switchDevice(device.device_id);
              }}
              data-testid={`device-switch-${device.device_id}`}
              className={cn('flex items-start gap-2 cursor-pointer', isActive && 'bg-muted/60')}
            >
              <div className="w-4 pt-0.5">
                {isActive && <Check className="w-4 h-4 text-primary" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{device.label}</p>
                <p className="text-[10px] text-muted-foreground font-mono truncate">
                  {device.device_id}
                </p>
              </div>
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/setup?mode=add-device" className="cursor-pointer" data-testid="device-add-link">
            <Plus className="w-3.5 h-3.5 mr-2" /> Tambah perangkat baru
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
