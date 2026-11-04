using System;
using System.IO;

// Test-only Windows reader that deliberately denies FILE_SHARE_DELETE.
class HoldConfigFile {
    static void Main(string[] args) {
        if (args.Length != 1) throw new ArgumentException("owned fixture path required");
        FileStream held = null;
        try {
            string command;
            while ((command = Console.ReadLine()) != null) {
                if (command == "hold") {
                    if (held != null) throw new InvalidOperationException("already held");
                    held = new FileStream(args[0], FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
                    Console.WriteLine("held"); Console.Out.Flush();
                } else if (command == "release") {
                    if (held != null) held.Dispose(); held = null;
                    Console.WriteLine("released"); Console.Out.Flush();
                } else if (command == "quit") break;
                else throw new ArgumentException("unknown fixture command");
            }
        } finally { if (held != null) held.Dispose(); }
    }
}
