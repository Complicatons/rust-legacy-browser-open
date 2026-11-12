// Minimal, functionally real stand-in for uLink.BitStream: only the public read API and the two members
// (_data, isTypeSafe) the admission-hook fix uses to build its own independent copy. Any consistent wire format is
// fine here since this stream is only ever written and read by this fixture's own test code.
using System;
using System.Text;

namespace uLink;

public class BitStream {
    readonly byte[] bytes;
    int pos;
    public readonly bool isTypeSafe;
    public byte[] _data => bytes;

    public BitStream(byte[] data, bool isTypeSafe) { bytes = data; this.isTypeSafe = isTypeSafe; }

    byte[] Take(int n) { var r = new byte[n]; Array.Copy(bytes, pos, r, 0, n); pos += n; return r; }
    public int ReadInt32() => BitConverter.ToInt32(Take(4));
    public byte ReadByte() => Take(1)[0];
    public ulong ReadUInt64() => BitConverter.ToUInt64(Take(8));
    public string ReadString() { int n = ReadInt32(); return n == 0 ? "" : Encoding.UTF8.GetString(Take(n)); }
    public byte[] ReadBytes() { int n = ReadInt32(); return Take(n); }
}
