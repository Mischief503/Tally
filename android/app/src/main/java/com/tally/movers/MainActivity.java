package com.tally.movers;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.provider.MediaStore;
import android.util.Log;
import android.view.ViewGroup;
import android.content.pm.PackageInfo;
import android.content.pm.Signature;
import android.os.Build;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.GeolocationPermissions;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import androidx.core.content.FileProvider;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.webkit.WebViewAssetLoader;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Tally for Android: the Tally web app, packaged inside the APK and shown full screen.
 *
 * The page is served from https://appassets.androidplatform.net/assets/ so it runs on a
 * secure address (sign-in, location and storage all need one) without needing a website.
 * Everything else the page links to (phone calls, texts, maps) opens in the phone's own apps.
 */
public class MainActivity extends Activity {
    private static final String TAG = "TallyWeb";
    private static final String HOST = "appassets.androidplatform.net";
    private static final String START = "https://" + HOST + "/assets/index.html";
    private static final int REQ_FILES = 41;
    private static final int REQ_LOCATION = 42;

    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private Uri cameraUri;
    private String geoOrigin;
    private GeolocationPermissions.Callback geoCallback;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFF141B2D);
        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        // Android 15 draws apps edge to edge. Keep Tally clear of the status bar, the
        // navigation bar, any camera cutout, and the keyboard.
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars()
                    | WindowInsetsCompat.Type.displayCutout()
                    | WindowInsetsCompat.Type.ime());
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return WindowInsetsCompat.CONSUMED;
        });

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setGeolocationEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setSupportMultipleWindows(false);
        s.setUserAgentString(s.getUserAgentString() + " TallyAndroid/" + BuildConfig.VERSION_NAME);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);

        final WebViewAssetLoader assets = new WebViewAssetLoader.Builder()
                .setDomain(HOST)
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assets.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if (HOST.equals(u.getHost())) return false;
                openOutside(u);
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                return chooseFiles(callback, params);
            }

            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                if (hasLocation()) {
                    callback.invoke(origin, true, false);
                    return;
                }
                geoOrigin = origin;
                geoCallback = callback;
                requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_LOCATION);
            }

            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                Log.i(TAG, m.messageLevel() + " " + m.message() + " (" + m.sourceId() + ":" + m.lineNumber() + ")");
                return true;
            }
        });

        web.addJavascriptInterface(new NativeBridge(), "TallyNative");

        if (saved != null) web.restoreState(saved);
        else web.loadUrl(START);
    }

    /* ---------- Google Maps distances ----------
       The Google key comes from the TALLY_GOOGLE_MAPS_KEY repository secret at build time.
       Each request names this app and its signing key, so a key restricted to
       "Android apps: com.tally.movers + this SHA-1" works here and nowhere else. */
    private class NativeBridge {
        @JavascriptInterface
        public boolean hasGoogle() {
            return BuildConfig.MAPS_KEY != null && !BuildConfig.MAPS_KEY.isEmpty();
        }

        @JavascriptInterface
        public void routeDistance(final String id, final String from, final String to) {
            new Thread(() -> {
                final String result = googleRoute(from, to);
                runOnUiThread(() -> {
                    if (web != null) web.evaluateJavascript("window.__tallyNativeDone&&window.__tallyNativeDone(" + JSONObject.quote(id) + "," + result + ")", null);
                });
            }).start();
        }
    }

    private String googleRoute(String from, String to) {
        try {
            JSONObject body = new JSONObject();
            body.put("origin", new JSONObject().put("address", from));
            body.put("destination", new JSONObject().put("address", to));
            body.put("travelMode", "DRIVE");
            HttpURLConnection c = (HttpURLConnection) new URL("https://routes.googleapis.com/directions/v2:computeRoutes").openConnection();
            c.setConnectTimeout(15000);
            c.setReadTimeout(20000);
            c.setRequestMethod("POST");
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json");
            c.setRequestProperty("X-Goog-Api-Key", BuildConfig.MAPS_KEY);
            c.setRequestProperty("X-Goog-FieldMask", "routes.distanceMeters,routes.duration");
            c.setRequestProperty("X-Android-Package", getPackageName());
            c.setRequestProperty("X-Android-Cert", signingSha1());
            try (OutputStream o = c.getOutputStream()) {
                o.write(body.toString().getBytes(StandardCharsets.UTF_8));
            }
            int code = c.getResponseCode();
            String text = readAll(code >= 400 ? c.getErrorStream() : c.getInputStream());
            JSONObject out = new JSONObject();
            if (code == 200) {
                JSONObject res = new JSONObject(text.isEmpty() ? "{}" : text);
                JSONArray routes = res.optJSONArray("routes");
                if (routes == null || routes.length() == 0 || !routes.getJSONObject(0).has("distanceMeters")) {
                    return out.put("ok", false).put("message", "No driving route between those addresses. Check them.").toString();
                }
                JSONObject r = routes.getJSONObject(0);
                double miles = Math.round(r.getDouble("distanceMeters") / 1609.344 * 10) / 10.0;
                long secs = Long.parseLong(r.optString("duration", "0s").replace("s", "").trim().isEmpty() ? "0" : r.optString("duration", "0s").replace("s", "").trim());
                return out.put("ok", true).put("src", "google").put("miles", miles).put("minutes", Math.round(secs / 60.0)).toString();
            }
            Log.w(TAG, "Google Routes " + code + ": " + text);
            if (code == 400 && text.toLowerCase().matches("(?s).*(address|geocod|location).*")) {
                return out.put("ok", false).put("message", "Google Maps could not find one of those addresses.").toString();
            }
            if (code == 401 || code == 403) {
                return out.put("ok", false).put("keyProblem", true).put("message", "Google Maps turned the key down (" + code + "). Check the key's app restriction and that Routes API is on.").toString();
            }
            return out.put("ok", false).put("keyProblem", true).put("message", "Google Maps did not answer (" + code + ").").toString();
        } catch (Exception e) {
            Log.w(TAG, "Google Routes failed: " + e);
            try {
                return new JSONObject().put("ok", false).put("keyProblem", true).put("message", "Could not reach Google Maps. Check the phone's connection.").toString();
            } catch (Exception ignored) {
                return "{\"ok\":false}";
            }
        }
    }

    private static String readAll(InputStream in) throws java.io.IOException {
        if (in == null) return "";
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) b.write(buf, 0, n);
        in.close();
        return b.toString("UTF-8");
    }

    /* The SHA-1 of the key this APK is signed with: what Google checks against the key's restriction. */
    @SuppressWarnings("deprecation")
    private String signingSha1() {
        try {
            Signature[] sigs;
            if (Build.VERSION.SDK_INT >= 28) {
                PackageInfo pi = getPackageManager().getPackageInfo(getPackageName(), PackageManager.GET_SIGNING_CERTIFICATES);
                sigs = pi.signingInfo.getApkContentsSigners();
            } else {
                PackageInfo pi = getPackageManager().getPackageInfo(getPackageName(), PackageManager.GET_SIGNATURES);
                sigs = pi.signatures;
            }
            byte[] d = MessageDigest.getInstance("SHA-1").digest(sigs[0].toByteArray());
            StringBuilder sb = new StringBuilder();
            for (byte x : d) sb.append(String.format("%02X", x));
            return sb.toString();
        } catch (Exception e) {
            return "";
        }
    }

    /* Calls, texts, maps and websites open in the phone's own apps. */
    private void openOutside(Uri u) {
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, u);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        } catch (ActivityNotFoundException e) {
            Log.w(TAG, "Nothing on this phone opens " + u.getScheme());
        }
    }

    /* Photo and form uploads: the phone's picker, with the camera offered first for photos. */
    private boolean chooseFiles(ValueCallback<Uri[]> callback, WebChromeClient.FileChooserParams params) {
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        fileCallback = callback;
        cameraUri = null;

        List<String> types = new ArrayList<>();
        for (String t : params.getAcceptTypes()) {
            for (String part : t.split(",")) {
                String p = part.trim();
                if (!p.isEmpty()) types.add(p);
            }
        }
        boolean images = types.isEmpty();
        for (String t : types) if (t.startsWith("image/")) images = true;

        Intent pick = new Intent(Intent.ACTION_GET_CONTENT);
        pick.addCategory(Intent.CATEGORY_OPENABLE);
        if (types.size() == 1) pick.setType(types.get(0));
        else {
            pick.setType("*/*");
            if (!types.isEmpty()) pick.putExtra(Intent.EXTRA_MIME_TYPES, types.toArray(new String[0]));
        }
        pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE);

        Intent chooser = Intent.createChooser(pick, images ? "Add photos" : "Choose a file");
        if (images) {
            try {
                File dir = new File(getCacheDir(), "camera");
                if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("no camera folder");
                File photo = File.createTempFile("tally-", ".jpg", dir);
                cameraUri = FileProvider.getUriForFile(this, getPackageName() + ".files", photo);
                Intent camera = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                camera.putExtra(MediaStore.EXTRA_OUTPUT, cameraUri);
                camera.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                camera.setClipData(ClipData.newRawUri("photo", cameraUri));
                chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{camera});
            } catch (Exception e) {
                Log.w(TAG, "Camera not offered: " + e.getMessage());
                cameraUri = null;
            }
        }
        try {
            startActivityForResult(chooser, REQ_FILES);
            return true;
        } catch (ActivityNotFoundException e) {
            fileCallback = null;
            callback.onReceiveValue(null);
            return false;
        }
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != REQ_FILES || fileCallback == null) return;
        Uri[] out = null;
        if (result == RESULT_OK) {
            if (data != null && data.getClipData() != null && data.getClipData().getItemCount() > 0
                    && !(cameraUri != null && cameraUri.equals(data.getClipData().getItemAt(0).getUri()))) {
                ClipData clip = data.getClipData();
                out = new Uri[clip.getItemCount()];
                for (int i = 0; i < clip.getItemCount(); i++) out[i] = clip.getItemAt(i).getUri();
            } else if (data != null && data.getData() != null) {
                out = new Uri[]{data.getData()};
            } else if (cameraUri != null) {
                out = new Uri[]{cameraUri};
            }
        }
        Log.i(TAG, "files chosen: " + (out == null ? 0 : out.length) + " " + Arrays.toString(out));
        fileCallback.onReceiveValue(out);
        fileCallback = null;
        cameraUri = null;
    }

    private boolean hasLocation() {
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public void onRequestPermissionsResult(int request, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(request, permissions, results);
        if (request == REQ_LOCATION && geoCallback != null) {
            geoCallback.invoke(geoOrigin, hasLocation(), false);
            geoCallback = null;
            geoOrigin = null;
        }
    }

    /* Back closes whatever is open in Tally (a job, the signing screen, a menu) before leaving. */
    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        if (web != null) web.saveState(out);
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (web != null) web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
