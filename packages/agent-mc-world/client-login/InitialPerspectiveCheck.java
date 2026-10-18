import org.cortico.minecraft.InitialPerspective;

public final class InitialPerspectiveCheck {
    public static void main(String[] args) {
        if (InitialPerspective.select(null) != -1) throw new AssertionError("Missing config changes the view");
        if (InitialPerspective.select("") != -1) throw new AssertionError("Empty config changes the view");
        if (InitialPerspective.select("unchanged") != -1) throw new AssertionError("Unchanged config changes the view");
        if (InitialPerspective.select("third_person_back") != 1) throw new AssertionError("Rear view");
        if (InitialPerspective.select("third_person_front") != 2) throw new AssertionError("Front view");
        if (InitialPerspective.select("first_person") != 0) throw new AssertionError("First person");
        if (InitialPerspective.select("invented") != -1) throw new AssertionError("Unknown view overrides current view");
        System.out.println("Initial perspective: 7 checks passed; missing/unknown values preserve the existing view");
    }
}
