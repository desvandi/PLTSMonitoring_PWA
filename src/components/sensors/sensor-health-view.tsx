'use client';
import { useStatus } from '@/hooks/useApi';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export function SensorHealthView() {
  const { data } = useStatus();
  const health = data?.health; // SystemStatus.health already unwrapped

  const sensors = [
    { name: 'INA219 (Battery Current)', status: health?.sensorHealth?.ina219 || 'OFFLINE' },
    { name: 'Battery ADC (Voltage)', status: health?.sensorHealth?.batteryAdc || 'OFFLINE' },
    { name: 'ACS712 (AC Current)', status: health?.sensorHealth?.acs712 || 'OFFLINE' },
    { name: 'SHT31 (Temp/Humidity)', status: health?.sensorHealth?.sht31 || 'OFFLINE' },
  ];

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-2xl font-bold">Sensor Health</h2>
      <div className="grid gap-3">
        {sensors.map((sensor, i) => (
          <Card key={i} className="p-4 flex items-center justify-between">
            <span className="font-medium">{sensor.name}</span>
            <Badge variant={sensor.status === 'ONLINE' ? 'default' : 'destructive'}>{sensor.status}</Badge>
          </Card>
        ))}
      </div>
    </div>
  );
}
