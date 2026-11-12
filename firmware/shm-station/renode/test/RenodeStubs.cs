// Sustitutos MÍNIMOS de las interfaces de Renode, solo para compilar y probar
// ADXL355_SHM.cs sin Renode. No forman parte de lo que se carga en Renode.
namespace Antmicro.Renode.Core { }
namespace Antmicro.Renode.Peripherals.SPI
{
    public interface ISPIPeripheral
    {
        byte Transmit(byte data);
        void FinishTransmission();
        void Reset();
    }
}
namespace Antmicro.Renode.Logging
{
    public enum LogLevel { Noisy, Debug, Info, Warning, Error }
    public static class LoggingExtensions
    {
        public static void Log(this object o, LogLevel level, string message, params object[] args)
        {
            System.Console.WriteLine("[" + level + "] " + string.Format(message, args));
        }
    }
}
