package dev.qiandengji.auracache;

import java.io.ByteArrayInputStream;
import java.io.DataInputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.TreeSet;

/** No ASM dependency: compare all HotSwap structural constraints before packaging. */
public final class ClassShape {
    public static String read(byte[] bytes) throws Exception {
        try (DataInputStream in = new DataInputStream(new ByteArrayInputStream(bytes))) {
            if (in.readInt() != 0xcafebabe) throw new IllegalArgumentException("Invalid class");
            int minor = in.readUnsignedShort(), major = in.readUnsignedShort();
            Object[] pool = new Object[in.readUnsignedShort()];
            for (int i = 1; i < pool.length; i++) {
                switch (in.readUnsignedByte()) {
                    case 1 -> pool[i] = in.readUTF();
                    case 3, 4 -> in.skipNBytes(4);
                    case 5, 6 -> { in.skipNBytes(8); i++; }
                    case 7, 8, 16, 19, 20 -> pool[i] = in.readUnsignedShort();
                    case 9, 10, 11, 12, 17, 18 -> in.skipNBytes(4);
                    case 15 -> in.skipNBytes(3);
                    default -> throw new IllegalArgumentException("Unknown constant tag");
                }
            }
            List<String> shape = new ArrayList<>();
            shape.add("version=" + major + "." + minor);
            shape.add("flags=" + in.readUnsignedShort());
            shape.add("class=" + name(pool, in.readUnsignedShort()));
            shape.add("super=" + name(pool, in.readUnsignedShort()));
            int interfaces = in.readUnsignedShort();
            for (int i = 0; i < interfaces; i++) shape.add("interface=" + name(pool, in.readUnsignedShort()));
            members(in, pool, shape, "field");
            members(in, pool, shape, "method");
            int attributes = in.readUnsignedShort();
            for (int i = 0; i < attributes; i++) {
                String attribute = (String) pool[in.readUnsignedShort()];
                byte[] value = in.readNBytes(in.readInt());
                try (DataInputStream a = new DataInputStream(new ByteArrayInputStream(value))) {
                    if (attribute.equals("NestHost")) shape.add("nestHost=" + name(pool, a.readUnsignedShort()));
                    else if (attribute.equals("NestMembers") || attribute.equals("PermittedSubclasses")) {
                        int n = a.readUnsignedShort();
                        for (int j = 0; j < n; j++) shape.add(attribute + "=" + name(pool, a.readUnsignedShort()));
                    } else if (attribute.equals("Record")) {
                        int n = a.readUnsignedShort();
                        for (int j = 0; j < n; j++) {
                            shape.add("record=" + pool[a.readUnsignedShort()] + ":" + pool[a.readUnsignedShort()]);
                            skipAttributes(a);
                        }
                    }
                }
            }
            return String.join("\n", new TreeSet<>(shape));
        }
    }
    private static String name(Object[] pool, int index) { return index == 0 ? "" : (String) pool[(Integer) pool[index]]; }
    private static void members(DataInputStream in, Object[] pool, List<String> shape, String kind) throws Exception {
        int n = in.readUnsignedShort();
        for (int i = 0; i < n; i++) {
            shape.add(kind + "=" + in.readUnsignedShort() + ":" + pool[in.readUnsignedShort()] + ":" + pool[in.readUnsignedShort()]);
            skipAttributes(in);
        }
    }
    private static void skipAttributes(DataInputStream in) throws Exception {
        int count = in.readUnsignedShort();
        for (int i = 0; i < count; i++) { in.readUnsignedShort(); in.skipNBytes(Integer.toUnsignedLong(in.readInt())); }
    }
    public static void main(String[] args) throws Exception {
        String original = read(Files.readAllBytes(Path.of(args[0])));
        String patched = read(Files.readAllBytes(Path.of(args[1])));
        if (!original.equals(patched)) throw new IllegalStateException("Class shape differs\nORIGINAL\n" + original + "\nPATCHED\n" + patched);
        System.out.println("HotSwap shape identical:\n" + original);
    }
}
