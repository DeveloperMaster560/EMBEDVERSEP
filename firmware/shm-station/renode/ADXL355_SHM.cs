// ADXL355_SHM.cs - Modelo SPI del ADXL355 para Renode.
//
// *** Mapa de registros NO VERIFICADO ***: usa los mismos valores que
// include/adxl355_regs.h. Comprueba la lógica del firmware, no el sensor.
//
// Protocolo: el primer byte de cada transferencia es (registro << 1) | RW;
// los siguientes leen o escriben registros consecutivos. Cada lectura que
// empieza en XDATA3 avanza una muestra de la señal cargada con LoadFeed.
//
// Desde el monitor de Renode:
//   sysbus.spi1.adxl355 LoadFeed @feeds/sd-v2-m.csv
//   sysbus.spi1.adxl355 Disconnected true
//   sysbus.spi1.adxl355 SetAcceleration 0 0 1

using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using Antmicro.Renode.Core;
using Antmicro.Renode.Logging;
using Antmicro.Renode.Peripherals.SPI;

namespace Antmicro.Renode.Peripherals.Sensors
{
    public class ADXL355_SHM : ISPIPeripheral
    {
        public ADXL355_SHM()
        {
            feed = new List<double[]>();
            Reset();
        }

        public void Reset()
        {
            first = true;
            reading = false;
            address = 0;
            range = 1;
            standby = true;
            filter = 0;
            sampleIndex = 0;
            current = new double[] { 0, 0, 1 };
        }

        public bool Disconnected { get; set; }

        public ulong SamplesServed => samplesServed;

        public void SetAcceleration(double xG, double yG, double zG)
        {
            feed.Clear();
            current = new double[] { xG, yG, zG };
        }

        public void LoadFeed(string path)
        {
            var list = new List<double[]>();
            foreach(var line in File.ReadAllLines(path))
            {
                if(line.Length == 0 || line[0] == '#')
                {
                    continue;
                }
                var p = line.Split(',');
                if(p.Length < 3)
                {
                    continue;
                }
                list.Add(new double[] {
                    double.Parse(p[0], CultureInfo.InvariantCulture),
                    double.Parse(p[1], CultureInfo.InvariantCulture),
                    double.Parse(p[2], CultureInfo.InvariantCulture),
                });
            }
            feed = list;
            sampleIndex = 0;
            this.Log(LogLevel.Info, "Señal cargada: {0} muestras de {1}", list.Count, path);
        }

        public byte Transmit(byte data)
        {
            if(Disconnected)
            {
                // Sin sensor, MISO no lo conduce nadie.
                first = true;
                return 0x00;
            }
            if(first)
            {
                first = false;
                address = (byte)(data >> 1);
                reading = (data & 1) == 1;
                if(reading && address == XDATA3)
                {
                    LatchSample();
                }
                return 0x00;
            }
            byte result = 0;
            if(reading)
            {
                result = ReadRegister(address);
            }
            else
            {
                WriteRegister(address, data);
            }
            address++;
            return result;
        }

        public void FinishTransmission()
        {
            first = true;
        }

        private void LatchSample()
        {
            if(feed.Count > 0)
            {
                current = feed[(int)(sampleIndex % (ulong)feed.Count)];
                sampleIndex++;
            }
            samplesServed++;
            double lsbPerG = range == 3 ? 64000 : range == 2 ? 128000 : 256000;
            for(var k = 0; k < 3; k++)
            {
                var raw = (long)Math.Round(current[k] * lsbPerG);
                raw = Math.Max(-524288, Math.Min(524287, raw));
                var v = (uint)(raw & 0xFFFFF);
                latched[k * 3] = (byte)(v >> 12);
                latched[k * 3 + 1] = (byte)(v >> 4);
                latched[k * 3 + 2] = (byte)((v & 0xF) << 4);
            }
        }

        private byte ReadRegister(byte reg)
        {
            switch(reg)
            {
                case 0x00: return 0xAD;
                case 0x01: return 0x1D;
                case 0x02: return 0xED;
                case 0x04: return standby ? (byte)0 : (byte)1;
                case 0x28: return filter;
                case 0x2C: return range;
                case 0x2D: return standby ? (byte)1 : (byte)0;
            }
            if(reg >= XDATA3 && reg < XDATA3 + 9)
            {
                return latched[reg - XDATA3];
            }
            return 0;
        }

        private void WriteRegister(byte reg, byte value)
        {
            switch(reg)
            {
                case 0x28: filter = value; break;
                case 0x2C: range = (byte)(value & 3); if(range == 0) { range = 1; } break;
                case 0x2D: standby = (value & 1) == 1; break;
                case 0x2F: if(value == 0x52) { Reset(); } break;
            }
        }

        private const byte XDATA3 = 0x08;

        private bool first;
        private bool reading;
        private byte address;
        private byte range;
        private byte filter;
        private bool standby;
        private ulong sampleIndex;
        private ulong samplesServed;
        private double[] current;
        private List<double[]> feed;
        private readonly byte[] latched = new byte[9];
    }
}
