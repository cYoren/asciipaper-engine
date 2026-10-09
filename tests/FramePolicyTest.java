package io.github.cyoren.asciipaper;

// Run by tests/test_runtime.py with the host JDK; no Android or JUnit dependency.
public final class FramePolicyTest {
    private static void equal(long expected, long actual, String scenario) {
        if (expected != actual) throw new AssertionError(scenario + ": expected " + expected + ", got " + actual);
    }

    public static void main(String[] args) {
        FramePolicy normal = new FramePolicy(24, 12);
        equal(24, normal.rate(1999, 0, false, 0), "interaction stays active for two seconds");
        equal(12, normal.rate(2000, 0, false, 0), "idle transition at two seconds");
        equal(24, normal.rate(2001, 2001, false, 0), "new touch restores active rate");
        equal(12, normal.rate(1, 0, true, 0), "battery saver active cap");
        equal(6, normal.rate(3000, 0, true, 0), "battery saver idle cap");
        equal(12, normal.rate(1, 0, false, 2), "moderate heat active cap");
        equal(6, normal.rate(3000, 0, false, 2), "moderate heat idle cap");
        equal(6, normal.rate(1, 0, false, 3), "severe heat cap");
        equal(1, normal.rate(1, 0, false, 4), "critical heat cap");
        equal(1, normal.rate(1, 0, true, 6), "most restrictive policy wins");
        equal(24, normal.rate(1, 0, false, 0), "recovery restores configured rate");
        equal(8, new FramePolicy(8, 60).rate(3000, 0, false, 0), "idle never exceeds active");
        equal(1, new FramePolicy(1, 1).rate(1, 0, true, 3), "power policy never raises a low rate");
        equal(60, new FramePolicy(1000, 12).rate(1, 0, false, 0), "upper input bound");
        equal(1, new FramePolicy(0, -10).rate(3000, 0, false, 0), "invalid input cannot cause a busy loop");
        for (int fps = 1; fps <= 60; fps++) {
            long delay = new FramePolicy(fps, fps).delay(1, 0, false, 0);
            if (delay * fps < 1000 || delay <= 0) throw new AssertionError("frame cap exceeded at " + fps);
        }
        System.out.println("Frame policy: interaction, battery, thermal, recovery and all 60 frame caps passed");
    }
}
