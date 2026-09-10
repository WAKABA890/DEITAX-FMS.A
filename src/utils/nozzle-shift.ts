export const calculateShiftVolume = (currentMeterReading: number, openingMeterReading: number) => {
  const current = Number(currentMeterReading) || 0;
  const opening = Number(openingMeterReading) || 0;
  return Math.max(0, current - opening);
};
