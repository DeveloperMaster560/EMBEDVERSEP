// Prueba del modelo con la misma secuencia SPI que usa app.c.
using System;
using System.IO;
using Antmicro.Renode.Peripherals.Sensors;

static class ModelTest
{
    static byte[] Xfer(ADXL355_SHM m, params byte[] tx)
    {
        var rx = new byte[tx.Length];
        for (var i = 0; i < tx.Length; i++) rx[i] = m.Transmit(tx[i]);
        m.FinishTransmission();
        return rx;
    }
    static byte Rd(byte reg) => (byte)((reg << 1) | 1);
    static byte Wr(byte reg) => (byte)(reg << 1);
    static int Raw20(byte[] b, int o)
    {
        var v = (b[o] << 12) | (b[o + 1] << 4) | (b[o + 2] >> 4);
        if ((v & 0x80000) != 0) v |= unchecked((int)0xFFF00000);
        return v;
    }
    static int fails;
    static void Check(bool ok, string what) { Console.WriteLine((ok ? "OK    " : "FALLO ") + what); if (!ok) fails++; }

    static int Main(string[] args)
    {
        var m = new ADXL355_SHM();
        var id = Xfer(m, Rd(0x00), 0xFF, 0xFF, 0xFF);
        Check(id[1] == 0xAD && id[2] == 0x1D && id[3] == 0xED, "identidad AD/1D/ED en una ráfaga");

        Xfer(m, Wr(0x2C), 1); Xfer(m, Wr(0x28), 3); Xfer(m, Wr(0x2D), 0);
        Check((Xfer(m, Rd(0x04), 0xFF)[1] & 1) == 1, "DATA_RDY tras salir de standby");

        m.SetAcceleration(0, 0, 1);
        var d = Xfer(m, Rd(0x08), 0, 0, 0, 0, 0, 0, 0, 0, 0);
        Check(Raw20(d, 7) == 256000 && Raw20(d, 1) == 0, "1 g en z = 256000 cuentas a ±2 g");

        m.SetAcceleration(-0.5, 0, 0);
        d = Xfer(m, Rd(0x08), 0, 0, 0, 0, 0, 0, 0, 0, 0);
        Check(Raw20(d, 1) == -128000, "signo: -0,5 g en x = -128000");

        m.SetAcceleration(0, 0, 3);
        d = Xfer(m, Rd(0x08), 0, 0, 0, 0, 0, 0, 0, 0, 0);
        Check(Raw20(d, 7) == 524287, "3 g a ±2 g satura en el fondo de escala");

        m.LoadFeed(args[0]);
        var lines = File.ReadAllLines(args[0]);
        string first = null;
        foreach (var l in lines) if (l.Length > 0 && l[0] != '#') { first = l; break; }
        var z0 = double.Parse(first.Split(',')[2], System.Globalization.CultureInfo.InvariantCulture);
        d = Xfer(m, Rd(0x08), 0, 0, 0, 0, 0, 0, 0, 0, 0);
        Check(Math.Abs(Raw20(d, 7) - z0 * 256000) <= 1, "la señal del gemelo llega muestra a muestra");

        m.Disconnected = true;
        id = Xfer(m, Rd(0x00), 0xFF, 0xFF, 0xFF);
        Check(id[1] == 0 && id[2] == 0 && id[3] == 0, "desconectado: el bus lee ceros");
        Check(Xfer(m, Rd(0x04), 0xFF)[1] == 0, "desconectado: sin DATA_RDY (el firmware no guarda ceros)");

        Console.WriteLine(fails == 0 ? "MODELO OK" : fails + " FALLOS");
        return fails == 0 ? 0 : 1;
    }
}
